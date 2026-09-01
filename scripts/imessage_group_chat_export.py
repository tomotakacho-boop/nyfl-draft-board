#!/usr/bin/env python3
"""Read one iMessage group chat and prepare a privacy-reviewed web archive."""

import argparse
import datetime as dt
import hashlib
import json
import os
import plistlib
import re
import shutil
import sqlite3
import subprocess
import sys
from pathlib import Path


APPLE_EPOCH = dt.datetime(2001, 1, 1, tzinfo=dt.timezone.utc)
X_URL_RE = re.compile(r"https?://(?:www\.)?(?:x\.com|twitter\.com)/[^\s<>\]\[\"']+", re.I)
LAUGH_EMOJI = ("😂", "🤣", "😆", "😹")
IMAGE_EXTENSIONS = {".avif", ".gif", ".heic", ".heif", ".jpeg", ".jpg", ".png", ".tif", ".tiff", ".webp"}
MEME_WORDS = ("meme", "reaction", "funny", "lol", "lmao", "rofl", "gif")


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True, help="Private JSON configuration file")
    parser.add_argument("--list-chats", action="store_true", help="List group chats and exit")
    parser.add_argument("--dry-run", action="store_true", help="Report matches/counts without copying files")
    parser.add_argument("--publish", action="store_true", help="Write reviewed web assets into the repository")
    return parser.parse_args()


def expand(value):
    return Path(os.path.expandvars(os.path.expanduser(str(value)))).resolve()


def connect_read_only(database):
    if not database.exists():
        raise RuntimeError(f"Messages database not found: {database}")
    uri = f"file:{database.as_posix()}?mode=ro"
    connection = sqlite3.connect(uri, uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    return connection


def table_columns(connection, table):
    return {row[1] for row in connection.execute(f"PRAGMA table_info({table})")}


def group_chats(connection):
    query = """
      SELECT c.ROWID AS row_id,
             COALESCE(NULLIF(c.display_name, ''), c.chat_identifier, '(untitled)') AS display_name,
             c.chat_identifier,
             GROUP_CONCAT(DISTINCT h.id) AS participants,
             COUNT(DISTINCT cmj.message_id) AS message_count
      FROM chat c
      LEFT JOIN chat_handle_join chj ON chj.chat_id = c.ROWID
      LEFT JOIN handle h ON h.ROWID = chj.handle_id
      LEFT JOIN chat_message_join cmj ON cmj.chat_id = c.ROWID
      GROUP BY c.ROWID
      HAVING COUNT(DISTINCT h.ROWID) > 1
      ORDER BY MAX(cmj.message_id) DESC
    """
    return [dict(row) for row in connection.execute(query)]


def print_chats(chats):
    print("ROWID  MESSAGES  CHAT  PARTICIPANTS")
    for chat in chats:
        people = chat.get("participants") or ""
        print(f"{chat['row_id']:<6} {chat['message_count']:<9} {chat['display_name']}  [{people}]")


def choose_chat(chats, selector):
    matches = chats
    if selector.get("rowId") is not None:
        matches = [chat for chat in matches if int(chat["row_id"]) == int(selector["rowId"])]
    name = str(selector.get("displayNameContains") or "").strip().casefold()
    if name:
        matches = [chat for chat in matches if name in str(chat.get("display_name") or "").casefold()]
    participants = [str(item).strip().casefold() for item in selector.get("participantContains", []) if str(item).strip()]
    for participant in participants:
        matches = [chat for chat in matches if participant in str(chat.get("participants") or "").casefold()]
    if not selector.get("rowId") and not name and not participants:
        raise RuntimeError("Configure chat.rowId, displayNameContains, or participantContains; refusing to guess.")
    if len(matches) != 1:
        candidates = ", ".join(f"{chat['row_id']}:{chat['display_name']}" for chat in matches[:10]) or "none"
        raise RuntimeError(f"Chat selector matched {len(matches)} chats ({candidates}). Make it more specific.")
    return matches[0]


def apple_timestamp(raw):
    if raw is None:
        return None
    value = float(raw)
    # Recent databases store nanoseconds; older versions may store seconds.
    seconds = value / 1_000_000_000 if abs(value) > 10_000_000_000 else value
    return APPLE_EPOCH + dt.timedelta(seconds=seconds)


def printable_strings(blob):
    if not blob:
        return []
    if isinstance(blob, str):
        return [blob]
    candidates = []
    for encoding in ("utf-8", "utf-16-le"):
        decoded = bytes(blob).decode(encoding, errors="ignore")
        candidates.extend(re.findall(r"[^\x00-\x08\x0b\x0c\x0e-\x1f]{2,}", decoded))
    return candidates


def decode_attributed_body(blob):
    if not blob:
        return ""
    try:
        payload = plistlib.loads(bytes(blob))
        strings = []

        def walk(value):
            if isinstance(value, str):
                strings.append(value)
            elif isinstance(value, dict):
                for child in value.values():
                    walk(child)
            elif isinstance(value, (list, tuple)):
                for child in value:
                    walk(child)

        walk(payload)
        useful = [value for value in strings if len(value.strip()) > 1 and not value.startswith("__")]
        if useful:
            return max(useful, key=len).strip()
    except Exception:
        pass
    values = [value.strip() for value in printable_strings(blob) if len(value.strip()) > 1]
    filtered = [value for value in values if not value.startswith(("NS", "__kIM", "streamtyped"))]
    return max(filtered or values, key=len, default="")


def query_messages(connection, chat_id):
    columns = table_columns(connection, "message")
    optional = []
    for name in ("attributedBody", "payload_data", "associated_message_guid", "associated_message_type"):
        optional.append(f"m.{name}" if name in columns else f"NULL AS {name}")
    query = f"""
      SELECT m.ROWID AS row_id, m.guid, m.text, m.date, m.is_from_me,
             h.id AS sender_id, {', '.join(optional)}
      FROM chat_message_join cmj
      JOIN message m ON m.ROWID = cmj.message_id
      LEFT JOIN handle h ON h.ROWID = m.handle_id
      WHERE cmj.chat_id = ?
      ORDER BY m.date, m.ROWID
    """
    rows = []
    for raw in connection.execute(query, (chat_id,)):
        row = dict(raw)
        row["decoded_text"] = (row.get("text") or decode_attributed_body(row.get("attributedBody"))).strip()
        row["payload_text"] = decode_attributed_body(row.get("payload_data"))
        row["timestamp"] = apple_timestamp(row.get("date"))
        rows.append(row)
    return rows


def query_attachments(connection, chat_id):
    query = """
      SELECT a.ROWID AS attachment_id, a.guid AS attachment_guid, a.filename,
             a.mime_type, a.transfer_name, a.total_bytes,
             m.ROWID AS message_row_id, m.guid AS message_guid
      FROM chat_message_join cmj
      JOIN message m ON m.ROWID = cmj.message_id
      JOIN message_attachment_join maj ON maj.message_id = m.ROWID
      JOIN attachment a ON a.ROWID = maj.attachment_id
      WHERE cmj.chat_id = ?
      ORDER BY m.date, a.ROWID
    """
    return [dict(row) for row in connection.execute(query, (chat_id,))]


def clean_url(url):
    return url.rstrip(".,;:!?)]}\"")


def normalized_target(value):
    if not value:
        return ""
    return str(value).split("/")[-1]


def laugh_reaction_kind(message):
    try:
        reaction_type = int(message.get("associated_message_type") or 0)
    except (TypeError, ValueError):
        return None
    if reaction_type in (2003, 3003):
        return "remove" if reaction_type == 3003 else "add"
    recovered = f"{message.get('decoded_text', '')} {message.get('payload_text', '')}"
    if any(emoji in recovered for emoji in LAUGH_EMOJI) and 2000 <= reaction_type < 4000:
        return "remove" if reaction_type >= 3000 else "add"
    return None


def active_laugh_counts(messages):
    active = {}
    for message in messages:
        target = normalized_target(message.get("associated_message_guid"))
        kind = laugh_reaction_kind(message)
        if not target or not kind:
            continue
        reactor = "ME" if message.get("is_from_me") else (message.get("sender_id") or f"unknown:{message['row_id']}")
        active[(target, reactor)] = kind == "add"
    counts = {}
    for (target, _reactor), enabled in active.items():
        if enabled:
            counts[target] = counts.get(target, 0) + 1
    return counts


def sender_label(identifier, is_from_me, aliases, redact):
    if is_from_me:
        return aliases.get("ME", aliases.get("me", "You"))
    identifier = identifier or "Unknown"
    if identifier in aliases:
        return aliases[identifier]
    if not redact:
        return identifier
    token = hashlib.sha256(identifier.encode("utf-8")).hexdigest()[:6]
    return f"Member {token}"


def is_image(attachment):
    mime = str(attachment.get("mime_type") or "").lower()
    suffix = Path(str(attachment.get("filename") or attachment.get("transfer_name") or "")).suffix.lower()
    return mime.startswith("image/") or suffix in IMAGE_EXTENSIONS


def classify_image(attachment, caption, overrides):
    filename = str(attachment.get("filename") or "")
    transfer_name = str(attachment.get("transfer_name") or "")
    for key in (filename, transfer_name, str(attachment.get("attachment_guid") or "")):
        if key in overrides:
            value = str(overrides[key]).lower()
            if value in ("meme", "memes"):
                return "memes", 1.0, "manual override"
            if value in ("other", "otherimages", "other-images"):
                return "other", 1.0, "manual override"
            if value == "skip":
                return "skip", 1.0, "manual override"
    haystack = f"{filename} {transfer_name} {caption}".casefold()
    suffix = Path(filename or transfer_name).suffix.lower()
    if suffix == ".gif" or any(word in haystack for word in MEME_WORDS):
        return "memes", 0.92, "GIF/name/caption signal"
    if "screenshot" in haystack or suffix in (".png", ".webp"):
        return "memes", 0.72, "screenshot/web-image signal"
    if suffix in (".heic", ".heif") or re.search(r"(?:^|[/_])IMG[_-]?\d", filename, re.I):
        return "other", 0.86, "camera-image signal"
    return "other", 0.5, "ambiguous; defaulted to other"


def source_path(attachment):
    filename = attachment.get("filename")
    if not filename:
        return None
    candidate = expand(filename)
    return candidate if candidate.exists() else None


def media_stem(attachment):
    guid = str(attachment.get("attachment_guid") or attachment.get("attachment_id"))
    return hashlib.sha256(guid.encode("utf-8")).hexdigest()[:16]


def copy_private(source, archive_dir, attachment):
    target_dir = archive_dir / "originals"
    target_dir.mkdir(parents=True, exist_ok=True)
    suffix = source.suffix.lower() or ".bin"
    destination = target_dir / f"{media_stem(attachment)}{suffix}"
    if not destination.exists() or destination.stat().st_size != source.stat().st_size:
        shutil.copy2(source, destination)
    return destination


def make_web_copy(source, destination, max_pixels, quality):
    destination.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "/usr/bin/sips", "-s", "format", "jpeg", "-s", "formatOptions", str(quality),
        "-Z", str(max_pixels), str(source), "--out", str(destination),
    ]
    completed = subprocess.run(command, capture_output=True, text=True)
    if completed.returncode != 0:
        raise RuntimeError(f"Could not create web copy for {source.name}: {completed.stderr.strip()}")


def timestamp_fields(value):
    if not value:
        return None, None
    local = value.astimezone()
    return local.isoformat(), local.strftime("%b %-d, %Y · %-I:%M %p")


def main():
    args = parse_args()
    config_path = expand(args.config)
    config = json.loads(config_path.read_text(encoding="utf-8"))
    repo = Path(__file__).resolve().parents[1]
    database = expand(config.get("messagesDatabase", "~/Library/Messages/chat.db"))
    connection = connect_read_only(database)
    chats = group_chats(connection)
    if args.list_chats:
        print_chats(chats)
        return 0

    chat = choose_chat(chats, config.get("chat", {}))
    messages = query_messages(connection, chat["row_id"])
    cutoff = dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=int(config.get("lookbackDays", 730)))
    messages = [message for message in messages if not message["timestamp"] or message["timestamp"] >= cutoff]
    message_by_guid = {normalized_target(message["guid"]): message for message in messages if message.get("guid")}
    message_by_row = {message["row_id"]: message for message in messages}
    laugh_counts = active_laugh_counts(messages)
    aliases = config.get("senderAliases", {})
    redact = bool(config.get("redactUnknownSenders", True))
    minimum_haha = int(config.get("minimumHaha", 6))

    originals = [message for message in messages if not message.get("associated_message_guid")]
    links = []
    seen_links = set()
    for message in originals:
        urls = [clean_url(url) for url in X_URL_RE.findall(message.get("decoded_text") or "")]
        message["x_links"] = urls
        for url in urls:
            key = url.casefold()
            if key in seen_links:
                continue
            seen_links.add(key)
            timestamp, display = timestamp_fields(message.get("timestamp"))
            links.append({
                "url": url,
                "message": message.get("decoded_text") or "",
                "sender": sender_label(message.get("sender_id"), message.get("is_from_me"), aliases, redact),
                "timestamp": timestamp,
                "timestampDisplay": display,
                "messageGuidHash": hashlib.sha256(str(message.get("guid")).encode()).hexdigest()[:12],
            })

    popular = []
    for message in originals:
        count = laugh_counts.get(normalized_target(message.get("guid")), 0)
        if count < minimum_haha:
            continue
        timestamp, display = timestamp_fields(message.get("timestamp"))
        popular.append({
            "text": message.get("decoded_text") or "",
            "sender": sender_label(message.get("sender_id"), message.get("is_from_me"), aliases, redact),
            "timestamp": timestamp,
            "timestampDisplay": display,
            "hahaCount": count,
            "xLinks": message.get("x_links", []),
            "messageGuidHash": hashlib.sha256(str(message.get("guid")).encode()).hexdigest()[:12],
        })
    popular.sort(key=lambda item: (-item["hahaCount"], item.get("timestamp") or ""))

    attachments = [item for item in query_attachments(connection, chat["row_id"]) if is_image(item)]
    archive = expand(config.get("privateArchive", "~/Documents/NYFL Group Chat Archive"))
    overrides = config.get("imageBucketOverrides", {})
    publish_config = config.get("publish", {})
    max_images = int(publish_config.get("maxPublishedImagesPerBucket", 500))
    buckets = {"memes": [], "other": []}
    missing = 0
    for attachment in attachments:
        message = message_by_row.get(attachment.get("message_row_id"), {})
        caption = message.get("decoded_text") or ""
        bucket, confidence, reason = classify_image(attachment, caption, overrides)
        if bucket == "skip":
            continue
        source = source_path(attachment)
        if source is None:
            missing += 1
            continue
        timestamp, display = timestamp_fields(message.get("timestamp"))
        item = {
            "bucket": bucket,
            "caption": caption,
            "sender": sender_label(message.get("sender_id"), message.get("is_from_me"), aliases, redact),
            "timestamp": timestamp,
            "timestampDisplay": display,
            "hahaCount": laugh_counts.get(normalized_target(message.get("guid")), 0),
            "classificationConfidence": confidence,
            "classificationReason": reason,
            "attachmentGuidHash": hashlib.sha256(str(attachment.get("attachment_guid")).encode()).hexdigest()[:12],
        }
        if not args.dry_run:
            private_copy = copy_private(source, archive, attachment)
            item["privateOriginal"] = str(private_copy)
            if args.publish and len(buckets[bucket]) < max_images:
                web_relative = Path("group-chat-media") / bucket / f"{media_stem(attachment)}.jpg"
                web_destination = repo / web_relative
                make_web_copy(
                    source,
                    web_destination,
                    int(publish_config.get("maxImagePixels", 1600)),
                    int(publish_config.get("jpegQuality", 76)),
                )
                item["src"] = f"./{web_relative.as_posix()}"
        buckets[bucket].append(item)

    generated = dt.datetime.now().astimezone()
    payload = {
        "schemaVersion": 1,
        "generatedAt": generated.isoformat(),
        "generatedAtDisplay": generated.strftime("%b %-d, %Y · %-I:%M %p"),
        "chat": {
            "displayName": chat["display_name"],
            "identifierHash": hashlib.sha256(str(chat.get("chat_identifier")).encode()).hexdigest()[:12],
        },
        "counts": {
            "memes": len(buckets["memes"]),
            "otherImages": len(buckets["other"]),
            "xLinks": len(links),
            "popularMessages": len(popular),
            "missingAttachmentFiles": missing,
        },
        "memes": buckets["memes"],
        "otherImages": buckets["other"],
        "xLinks": links,
        "popularMessages": popular,
    }

    print(f"Matched chat: {chat['display_name']} (ROWID {chat['row_id']})")
    print(f"Messages scanned: {len(originals)}")
    print(f"Images: {len(buckets['memes'])} memes, {len(buckets['other'])} other, {missing} unavailable")
    print(f"X links: {len(links)}")
    print(f"Messages with {minimum_haha}+ active laughs: {len(popular)}")
    if args.dry_run:
        print("Dry run: no files were copied or written.")
        return 0

    archive.mkdir(parents=True, exist_ok=True)
    private_payload = archive / "group-chat-private-preview.json"
    private_payload.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Private preview: {private_payload}")
    if args.publish:
        public_payload = json.loads(json.dumps(payload))
        for bucket in ("memes", "otherImages"):
            public_payload[bucket] = [
                {key: value for key, value in item.items() if key != "privateOriginal"}
                for item in public_payload[bucket]
                if item.get("src")
            ]
        public_payload["counts"]["memes"] = len(public_payload["memes"])
        public_payload["counts"]["otherImages"] = len(public_payload["otherImages"])
        output = repo / "data" / "group-chat.json"
        output.write_text(json.dumps(public_payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"Published web index: {output}")
    else:
        print("Website unchanged. Review the private preview, then rerun with --publish.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeError, sqlite3.Error, OSError, json.JSONDecodeError) as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1)
