# Code signing policy

**Status:** application to the [SignPath Foundation](https://signpath.org) open source program in preparation. Once approved, Windows releases of NeuroTab Ponte will use:

> Free code signing provided by [SignPath.io](https://signpath.io), certificate by [SignPath Foundation](https://signpath.org).

## Scope

Signed artifact: `neurotab-ponte-windows-amd64.exe`, the optional companion app of the NeuroTab browser extension (source in [`ponte/`](../ponte)).
The browser extension itself is distributed by the browser stores and is not signed by this program. Third-party tools that NeuroTab Ponte can download on request (yt-dlp, ffmpeg) are signed or published by their own projects and are never re-signed by NeuroTab.

## How releases are built

- Source: the public repository [mpjbiologo/NeuroTab](https://github.com/mpjbiologo/NeuroTab), license MIT (OSI-approved), no dual licensing.
- Build: GitHub Actions, workflow [`.github/workflows/release.yml`](../.github/workflows/release.yml), job `ponte`, triggered only by publishing a GitHub release from a tag. No binary is built or uploaded by hand.
- Each release publishes `neurotab-ponte-SHA256SUMS.txt` with the SHA-256 of every file.

## Roles

| Role | Who |
| --- | --- |
| Author / committer | [Marcos de Paula Júnior (@mpjbiologo)](https://github.com/mpjbiologo) |
| Reviewer | [Marcos de Paula Júnior (@mpjbiologo)](https://github.com/mpjbiologo) |
| Approver (signing requests) | [Marcos de Paula Júnior (@mpjbiologo)](https://github.com/mpjbiologo) |

All team members use multi-factor authentication on GitHub and SignPath.

## Privacy

NeuroTab Ponte does not transfer any information to networked systems unless specifically requested by the user or the person installing or operating it:

- it only runs when the NeuroTab extension opens it (native messaging) and exits when the extension closes the connection;
- local network features (clipboard to phone, network diagnostics) stay on the local network;
- video downloads and the optional installation of yt-dlp/ffmpeg contact only the sites the user asked for and the official GitHub releases of those tools (verified by SHA-256).

Full privacy policy: [docs/privacy.html](privacy.html).
