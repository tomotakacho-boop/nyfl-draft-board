# Weekly iMessage group-chat archive

This workflow reads one local iMessage group chat and prepares four website collections:

- memes;
- other images;
- X/Twitter links;
- original messages with at least six active Haha or laughing-emoji Tapbacks.

The extractor opens `chat.db` in SQLite read-only mode. It does not send, edit, or delete messages. Full-resolution attachments are copied to a private archive outside the Git repository. Nothing reaches the website until you explicitly run the publish step and commit the reviewed output.

## 1. Protect the website and the source data

Assume a GitHub/Netlify site is public unless you have deliberately added authentication. Get the chat participants' permission before publishing their messages, reactions, names, images, or links. Never add `~/Library/Messages/chat.db`, its `-wal`/`-shm` files, or the private archive to GitHub.

The generated site data identifies unlisted senders with a stable pseudonym such as `Member a12f9c`. Add aliases only for names the group has agreed to show.

## 2. Give the local process access to Messages

On the Mac that owns the iMessage history:

1. Open **System Settings → Privacy & Security → Full Disk Access**.
2. Enable the terminal app you use to run the extractor.
3. If the scheduled job later receives `operation not permitted`, also grant Full Disk Access to the executable shown by `which python3`, or run the weekly command manually from the approved terminal.
4. Quit and reopen the terminal after changing permissions.

The script copies data only from this Mac. It does not connect to iCloud or bypass macOS permissions.

## 3. Create the private configuration

From the repository root:

```bash
cp scripts/group-chat-config.example.json .group-chat-config.json
```

Edit `.group-chat-config.json`. It is ignored by Git. Start by finding the exact group chat:

```bash
python3 scripts/imessage_group_chat_export.py \
  --config .group-chat-config.json \
  --list-chats
```

Put a distinctive part of its title in `displayNameContains`. If the group has no title, put one or more member phone numbers/emails in `participantContains`. You may instead add `"rowId": 123` inside `chat` after using the list command.

Add agreed display names under `senderAliases`, for example:

```json
"senderAliases": {
  "+13125551212": "Tomo",
  "friend@example.com": "Friend"
}
```

## 4. Preview without copying or publishing

```bash
python3 scripts/imessage_group_chat_export.py \
  --config .group-chat-config.json \
  --dry-run
```

This reports the matched chat and item counts. If multiple chats match, make the selector more specific. The script refuses to guess.

## 5. Build and privately review the archive

Run without `--publish` first:

```bash
python3 scripts/imessage_group_chat_export.py \
  --config .group-chat-config.json
```

This copies original attachments into the configured `privateArchive` and writes a private preview JSON there. Review it before publishing.

Image classification is intentionally conservative:

- GIFs and image files/captions containing words such as `meme`, `reaction`, or `gif` are classified as memes.
- screenshots and PNG/WebP files are treated as probable memes;
- camera-style HEIC/JPEG names are generally classified as other images;
- ambiguous items go to other images.

To correct a result, add the attachment's original filename or path to `imageBucketOverrides` with value `"meme"`, `"other"`, or `"skip"`, then rerun.

## 6. Publish the reviewed website copy

```bash
python3 scripts/imessage_group_chat_export.py \
  --config .group-chat-config.json \
  --publish
```

The publish step updates only:

- `data/group-chat.json`;
- `group-chat-media/memes/`;
- `group-chat-media/other/`.

Published images are resized/compressed copies. Review `git diff`, remove anything that should stay private, then commit and push normally. The script deliberately does not auto-commit or auto-push.

## 7. Install the weekly local job

Example: Sunday at 9:00 AM local time, private extraction only:

```bash
python3 scripts/install_weekly_group_chat_job.py \
  --config .group-chat-config.json \
  --weekday 0 \
  --hour 9 \
  --minute 0
```

Weekdays use Apple launchd numbering: `0` Sunday through `6` Saturday. Add `--publish` only if every participant has agreed to publishing and you are comfortable with the generated web copy appearing in the working tree automatically. A human still needs to review and push it.

Test the installed job:

```bash
launchctl kickstart -k "gui/$(id -u)/com.nyfl.group-chat-archive"
```

Logs are written inside the private archive. To remove the schedule:

```bash
launchctl bootout "gui/$(id -u)" \
  "$HOME/Library/LaunchAgents/com.nyfl.group-chat-archive.plist"
```

## Tapback counting notes

The extractor counts active reactions, not historical taps. A Haha add followed by its matching removal is no longer counted. Classic Haha Tapbacks use Apple's add/remove reaction records. Newer laughing-emoji Tapbacks are counted on a best-effort basis when the emoji is recoverable from the local attributed-body data. Each sender contributes at most one active laugh reaction to a message.

Apple can change the private Messages schema between macOS releases. Run `--dry-run` after major macOS updates and verify a few known messages manually before trusting the weekly result.
