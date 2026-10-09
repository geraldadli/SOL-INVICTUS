# SOL INVICTUS ☀️

**Own the sunshine. Share the future.**

SOL INVICTUS is a shared solar ownership app that demonstrates how a solar project can be represented by digital shares on Ethereum. Users buy solar shares called Sol Coins in the app (the deployed ERC-20 symbol is SURYA), track their holdings, transfer shares, and claim a proportional share of operator-deposited income.

The app models **Cikarang Rooftop Solar**, a fictional 10 kWp installation in West Java, with 1,000 equal shares. Solar assets and energy reports are simulated; purchases, transfers, and income claims on the public demo are real **Ethereum Sepolia testnet** transactions.

[Open the app](https://geraldadli.github.io/SOL-INVICTUS/) · [GitHub repository](https://github.com/geraldadli/SOL-INVICTUS)

## Features

- **Buy solar shares:** connect MetaMask and purchase available SURYA tokens with Sepolia test ETH.
- **Track your holdings:** view your share balance, ownership percentage, claimable income, and claimed income in My Sol Coins.
- **Claim income:** withdraw the income allocated to your shares directly to your wallet.
- **Transfer shares:** send tokens to another wallet while keeping previously earned income.
- **Publish energy reports:** the operator records sample monthly generation, operating costs, and reserves, then deposits the distributable income.
- **Inspect activity:** view purchases, transfers, reports, and claims with transaction receipts linked to Sepolia Etherscan.
- **Manage purchase proceeds:** the operator can withdraw share-sale proceeds separately from funds reserved for holder income.

## Reporting protections (version 2)

The public Sepolia contract, local contract, and browser simulation include these protections. The app also identifies older contracts that do not support them.

- **Reporting schedule:** the first report covers the previous completed UTC month and is due seven days after deployment. Each subsequent month can be reported only after it ends, with a seven-day grace period. For example, an October report opens November 1 at 00:00 UTC and is due November 8 at 00:00 UTC, inclusive.
- **Overdue reports:** the contract rejects new purchases after the deadline. Reports must be submitted in order; skipping months or reporting future months is rejected. Catching up must clear all overdue periods before purchases resume.
- **Manual purchase pause:** the existing operator can pause and resume purchases. Removing this pause does not override an overdue report, and publishing a report does not remove a manual pause.
- **Existing holder access:** income claims and token transfers remain available during either kind of purchase pause. Purchase-proceeds withdrawals remain operator-only and cannot spend reserved holder income.
- **Zero-income reports:** zero generation, break-even months, and losses can be reported with no deposit. Costs and reserves remain in the report; a shortfall creates no holder debt, does not reduce accrued income, and does not carry forward into later reports.

There is still one fixed operator wallet. Multisig administration, operator replacement, wallet recovery, refunds, and external revenue verification are not included. A report records the operator's statement; it cannot prove physical generation or compel an offchain payment.

## How income works

The operator deposits simulated electricity income after costs and reserves. Holders accrue income in proportion to their shares at that moment and claim it themselves. Claiming does not consume shares or automatically increase their price. Purchase proceeds are separate from income deposits.

There are 1,000 whole SURYA shares at 0.0001 test ETH each. Rp1 demo IDR = 1 gwei is only a display scale, not a real exchange rate. Unsold shares held by the operator also receive income. Transferring shares does not transfer previously accrued income and does not include resale payment.

## Try the live demo

You need MetaMask and Sepolia test ETH for purchases and gas. Use an investor account to buy shares; only the deployed contract's operator can publish reports.

1. Open the app and select **Connect wallet**. Allow the app to switch to Sepolia when prompted.
2. Open **Project** and purchase **100 shares** for **0.01 Sepolia ETH**, plus gas. These shares represent 10% of the demo project.
3. Open **My Sol Coins** to view your holdings, claim available income, or transfer tokens.
4. Use **Refresh** to load activity submitted by other wallets. Open a receipt to inspect its transaction on Etherscan.

To demonstrate an income cycle, connect the operator wallet and open **Operator lab**. Use the reporting month shown in the form, with **4,000 kWh**, **Rp800,000 costs**, and **Rp200,000 reserve**. This requires a **0.005 Sepolia ETH** deposit plus gas. A wallet holding 100 shares when the report is published earns **0.0005 Sepolia ETH** from that deposit, displayed as Rp500,000 in demo income. On version 2, a report for a month still in progress must wait until the displayed opening time.

## Run locally

Install Node.js 24 and npm, then clone the repository:

```sh
git clone https://github.com/geraldadli/SOL-INVICTUS.git
cd SOL-INVICTUS
npm ci
```

Build and preview the Sepolia-connected app:

```sh
npm run build:pages
npm run preview -- --base=/SOL-INVICTUS/
```

Open [the local preview](http://127.0.0.1:4173/SOL-INVICTUS/). No local blockchain node is needed for Sepolia. On Windows, use `npm.cmd` if PowerShell blocks `npm`.

For a browser simulation without a wallet or blockchain connection, run `npm run demo` and open [the simulation](http://127.0.0.1:5173). Switch between Alice, Budi, and the operator to try purchases, reports, transfers, and claims. Simulated balances are stored per browser tab and are separate from Sepolia balances.

In the simulation's Operator lab, use **Advance past reporting deadline** to demonstrate blocked purchases, or **Advance to next report opening** to publish another month without waiting. These controls only change the simulation clock. Reloading preserves its clock, reports, and pause state.

For local blockchain development, `npm start` launches a disposable Hardhat chain, deploys the contract, and starts the app. Restarting creates a fresh local demo.

## Tests

```sh
npm test
npm run test:simulation
node --test tests/metamask.test.mjs tests/wallet-network.test.mjs
npm run test:pages
```

`npm test` starts and stops its own isolated Hardhat chain on an available local port. It tests purchases, payouts, permissions, pauses, overdue reporting, zero-income reports, and UTC calendar boundaries. It does not change the running app's blockchain or clock.

## Deployment

- **Network:** Ethereum Sepolia (chain ID 11155111)
- **Contract (version 2):** [0x1c854b9976f682db7f65AF5AeFB03d313d35038E](https://sepolia.etherscan.io/address/0x1c854b9976f682db7f65AF5AeFB03d313d35038E)
- **Deployment transaction:** [View on Sepolia Etherscan](https://sepolia.etherscan.io/tx/0xe925c1402033c7b1ef1c3b662d0b7e217dbe2f75ebee0798edb83964fc538ec4)
- **Operator:** `0xaeEeC36568e5919ce3126ABde04285B90030F58b`
- **Hosting:** GitHub Pages, with automated tests, builds, and deployment on pushes to `main`.

The public contract configuration is stored in `deployments/sepolia.json`. The Pages build uses this configuration and excludes the development deployment page.

To deploy version 2 from the same operator wallet:

1. Run `npm run build`, then `npm run preview` and open [the local deployment page](http://127.0.0.1:4173/deploy.html).
2. Connect the operator account in MetaMask on Sepolia, then review and sign the deployment transaction.
3. Run `npm run connect:sepolia -- <deployment-transaction-hash>` to verify the exact compiled contract and update the public address and ABI. Use the same compiled build for deployment and verification.
4. Run `npm test` and `npm run test:pages` before publishing the updated configuration and app.

Each deployment creates a new contract with 1,000 fresh shares. Existing tokens and claimable income stay in their original contract; they are not migrated. Balances from the earlier demo remain at [0xBB3a9F81461aF1BF2FaD7c90A8D95FC3acca6065](https://sepolia.etherscan.io/address/0xBB3a9F81461aF1BF2FaD7c90A8D95FC3acca6065). The operator remains the deploying wallet and does not need additional administrator wallets.

## Tech stack

HTML, CSS, JavaScript, Vite, ethers, Solidity, OpenZeppelin, and Hardhat. The app reads Sepolia through a public RPC and signs transactions in MetaMask; no backend or private keys are hosted.

## Demo scope

This prototype uses test ETH and fictional assets. It does not connect to real solar hardware, utilities, fiat payments, or legal ownership rights. Transfers do not include resale payments. The operator address is fixed, the contracts are unaudited, and public RPC availability can affect loading.
