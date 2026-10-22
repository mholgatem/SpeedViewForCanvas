# Installing SpeedView in Safari

SpeedView isn't in the Mac App Store, so Safari users build it from this repository. This takes about five minutes, and everything happens on your Mac.

## Requirements

- macOS 14 (Sonoma) or newer with Safari 17 or newer
- [Xcode](https://apps.apple.com/app/xcode/id497799835) from the Mac App Store. Open it once after installing so it can finish setup.
- [Node.js](https://nodejs.org) 20 or newer

## Build

```sh
git clone https://github.com/mholgatem/SpeedViewForCanvas.git
cd SpeedViewForCanvas
./scripts/build-safari.sh
```

The script installs dependencies, builds the extension, wraps it in a small macOS app (Safari requires that), and puts the result in `build/safari/SpeedView for Canvas.app`.

## Enable it in Safari

1. **Safari → Settings → Advanced:** turn on **Show features for web developers**.
2. **Develop → Allow Unsigned Extensions.** Safari turns this off every time it quits. To avoid that, see "Signing" below.
3. Open `build/safari/SpeedView for Canvas.app` once. You can close it right away.
4. **Safari → Settings → Extensions:** check **SpeedView for Canvas**.
5. Click the SpeedView toolbar button on your Canvas site and choose **Enable**, or add the site under SpeedView's settings. When Safari asks whether SpeedView may access the site, choose **Always Allow on This Website**.

## Signing (optional, avoids step 2 on every launch)

A free Apple ID is enough.

1. Run `./scripts/build-safari.sh --xcode`. Xcode opens the generated project.
2. Select both targets (the app and the extension). Under **Signing & Capabilities**, choose your personal team.
3. Choose **Product → Run**.

## Updating

Pull the latest code and run the script again:

```sh
git pull
./scripts/build-safari.sh
```

## Privacy

The Safari build is the same code as the Chrome and Firefox versions. Student files are downloaded from your Canvas site, displayed in memory, and never sent anywhere. See [PRIVACY.md](../PRIVACY.md).
