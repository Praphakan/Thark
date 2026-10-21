# Thârk

<img width="1244" height="520" alt="Capture d’écran 2026-10-21 à 20 40 54" src="https://github.com/user-attachments/assets/0a6ba9b3-ad13-4107-8226-25bc936adccf" />


**Pay any Thai QR code with bitcoin.**

Thârk is a self-custodial Bitcoin wallet (Ark + Lightning) for Android, **forked from [Noah](https://github.com/smolcars/noah)**, that lets you pay any Thai PromptPay QR code with sats. A peer-to-peer network of "takers" pays the merchant in baht and earns sats in return, using [OpenPleb](https://github.com/gandlafbtc/open-pleb) as the P2P fiat bridge.

> ⚠️ **Beta software.** Thârk is under active development. Only use small amounts you can afford to lose.

## The name

**Thârk** blends three ideas:

- **TH**, for Thailand, where it was born.
- **Ark**, the Bitcoin layer-2 protocol it is built on (and a nod to Noah, the wallet it was forked from).
- **ท่า** (*thâ*), the Thai word for a pier or boat landing, the place where ferries cast off to cross the river. The circumflex in Thârk echoes its falling tone.

A landing from which an ark crosses between two shores: baht and bitcoin.

## Standing on the shoulders of pioneers

The idea of paying Thai QR codes with bitcoin through locals who settle in baht was pioneered by **[PlebQR](https://plebqr.com)**, which proved that a P2P "let me pay for you" market can make bitcoin spendable at virtually any shop in Thailand. Thârk is directly inspired by their work, and builds on the open-source [OpenPleb](https://github.com/gandlafbtc/open-pleb) project to bring that experience into a self-custodial Ark wallet.

## Features

- **Self-custodial Bitcoin wallet** built on [Ark](https://second.tech) (via Second's `bark`), with Lightning payments, inherited from Noah.
- **Pay Thai QR (PromptPay)**: scan a merchant QR, pay in sats, a taker pays the merchant in THB.
- **Escrow with automatic refunds**: if nobody takes your offer, your sats come back automatically (Cashu ecash escrow, P2PK-locked to your key).
- **Maker confirmation**: see the taker's payment proof and release the escrow yourself.
- **Taker mode**: enable it in Settings to earn sats by paying Thai QR codes for other users, directly from your Ark balance.
- **English and French** interface, following your phone's language.

## Download

APKs are published on the [Releases](../../releases) page (Android, arm64).

Verify that the APK was signed by Thârk. The signing certificate SHA-256 fingerprint is:

```
55cfba67cc1fec2e5343d8d762f8df3b656cef34419b5b0bd9e0d2691f80a3ac
```

You can check it with `apksigner verify --print-certs thark-x.y.z.apk`, or let [Obtainium](https://github.com/ImranR98/Obtainium) track releases and enforce it.

## How it works

1. **Maker** (you): scan a PromptPay QR; Thârk creates an offer and pays it in sats, held in Cashu ecash escrow.
2. **Taker**: takes the offer (posting a refundable bond), pays the merchant in THB from their banking app, and uploads the receipt.
3. **Settlement**: the maker confirms, or the payment auto-settles after a short dispute window. The taker receives the sats plus a fee, and the maker gets their bond back.
4. **No taker?** The offer expires after 3 minutes and the maker is refunded automatically.

## Current limitations

- Android only (iOS may come later).
- Some wallet services (Lightning address, encrypted backups, background push relay) still rely on infrastructure inherited from Noah.
- The escrow uses a public Cashu mint, which is custodial during the short life of an offer.

## Build from source

Requirements: [Bun](https://bun.sh), JDK 17, Android SDK.

```bash
bun install
cd client
bun run android:mainnet:debug        # debug build on a connected device
```

Release build: create `client/android/local.properties` with `MYAPP_RELEASE_STORE_FILE`, `MYAPP_RELEASE_KEY_ALIAS`, `MYAPP_RELEASE_STORE_PASSWORD` and `MYAPP_RELEASE_KEY_PASSWORD`, then:

```bash
bun run build:android:mainnet:ci:apk
```

## Credits

- **[Noah](https://github.com/smolcars/noah)**: Thârk is a fork of the Noah Ark wallet. Huge thanks to the Noah team.
- **[PlebQR](https://plebqr.com)**: the pioneers of paying Thai QR codes with bitcoin.
- **[OpenPleb](https://github.com/gandlafbtc/open-pleb)**: the open-source P2P fiat bridge powering Thârk's QR payments.
- **[Cashu](https://cashu.space)**: ecash escrow.
- **[Second](https://second.tech)**: the Ark protocol implementation (`bark`).

## License

[MIT](LICENSE)
