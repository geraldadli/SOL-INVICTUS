# SOL INVICTUS ☀️

**Own the sunshine. Share the future.**

This repository is a fresh snapshot of the local SuryaShare prototype. Earlier development history is available in [geraldadli/SuryaShare](https://github.com/geraldadli/SuryaShare). The current website and deployed SURYA contract retain their SuryaShare names. Earlier work predates this repository; migration does not reset its development timeline.

A hackathon prototype for shared solar ownership. The [public website](https://geraldadli.github.io/SOL-INVICTUS/) connects to **Ethereum Sepolia**: buy SURYA shares, publish sample solar income, transfer shares, and claim test ETH using MetaMask.

Solar assets and reports are fictional. Transactions are real testnet transactions. No real money, hardware, utilities, fiat payments, or legal ownership rights are connected.

## Connected deployment

- Network: Ethereum Sepolia (11155111)
- Contract: [0xBB3a9F81461aF1BF2FaD7c90A8D95FC3acca6065](https://sepolia.etherscan.io/address/0xBB3a9F81461aF1BF2FaD7c90A8D95FC3acca6065)
- Operator (Eden): `0xaeEeC36568e5919ce3126ABde04285B90030F58b`
- [Deployment transaction](https://sepolia.etherscan.io/tx/0xc8f4377113deabd63907f5cd6006cb3f93588fe5bd42581350d6c5dbb5e8148c)
- Deployment block: 11875135

The deployed executable code was compared with the project source compiled with Solidity 0.8.34, OpenZeppelin 5.6.1, Cancun, and optimization enabled at 200 runs. Compiler metadata was excluded from comparison; the immutable operator was checked against the deployment sender. This is a code match, not a security audit.

## Demo with Eden and Jacob

SuryaShare explicitly selects MetaMask through EIP-6963 discovery; other wallet extensions are not used. Both accounts can live in one MetaMask. Each needs Sepolia test ETH for gas. The deploying account is permanently the operator; it cannot buy shares.

1. Select **Jacob** in MetaMask, open the website, and choose **Connect MetaMask**.
2. Buy **100 shares** for **0.01 Sepolia ETH** plus gas. This represents Rp10,000,000 in demo units and 10% of the project.
3. Switch to **Eden** with **Switch MetaMask account** in the wallet menu; the site follows the selected account. Open **Operator lab**, which appears in the navigation for the operator.
4. Enter **4,000 kWh**, **Rp800,000 costs**, and **Rp200,000 reserve**, using a month later than the last published report. Publish and confirm the **0.005 Sepolia ETH** income deposit plus gas.
5. Switch back to **Jacob** and open **My shares**. Claim **0.0005 Sepolia ETH**, shown as Rp500,000 in demo income. Gas is paid separately.
6. The site checks for new activity every 30 seconds; use the **Refresh** icon on the Activity card to pick up transactions made by another account or through Remix right away. Receipts link to Sepolia Etherscan.

Sending ETH directly to Jacob or to the earlier SmartWallet does not buy SURYA shares. Use this site's purchase action. The old SmartWallet is not part of this integration.

## How income works

The operator deposits simulated electricity income after costs and reserves. Holders accrue income in proportion to their shares at that moment and claim it themselves. Claiming does not consume shares or automatically increase their price. Purchase proceeds are separate from income deposits.

There are 1,000 whole SURYA shares at 0.0001 test ETH each. Rp1 demo IDR = 1 gwei is only a display scale, not a real exchange rate. Unsold shares held by the operator also receive income. Transferring shares does not transfer previously accrued income and does not include resale payment.

## Run and verify

Use Node.js 24 and npm in `D:\Project-Website\SuryaShare`:

```sh
npm ci
npm run test:simulation
npm run test:pages
npm run preview -- --base=/SOL-INVICTUS/
```

The Pages test builds the connected site. Open http://127.0.0.1:4173/SOL-INVICTUS/ for its local preview. No local blockchain node is needed for Sepolia. On Windows use `npm.cmd` if PowerShell blocks `npm`.

Pushes to `main` test, build, and deploy through GitHub Actions. `deployments/sepolia.json` is the public contract configuration; it contains no private keys. The Pages build replaces any local deployment configuration with this file and excludes `deploy.html`.

The default CLI deployment tools use Solidity 0.8.30. `connect:sepolia` intentionally accepts only their exact compiled deployment bytecode; it does not accept this separately verified Remix 0.8.34 build. Do not redeploy or overwrite the connected configuration just to match that script.

## Optional offline simulation and local blockchain

`npm run demo` starts the separate browser simulation at http://127.0.0.1:5173. It uses Alice, Budi, and an operator with simulated balances stored per tab, and sends no blockchain transactions. Those balances are not migrated to Sepolia.

`npm start` starts a disposable Hardhat chain, deploys the contract, and launches the local blockchain version. With that chain running, `npm test` checks purchases, income, claims, transfers, and operator restrictions. `npm run build` includes the separate wallet deployment page for development.

## Stack and limits

HTML, CSS, JavaScript, Vite, ethers, Solidity, OpenZeppelin, and Hardhat. The public demo reads Sepolia through a public HTTPS RPC and signs transactions in the user's browser wallet; no backend or private keys are hosted.

The contracts are unaudited and intended only for test ETH. Public RPC availability can affect loading. There is no operator recovery, paid secondary market, hardware verification, or legal ownership integration.
