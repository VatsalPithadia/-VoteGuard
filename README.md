# VoteGuard — Smart Contracts

## Setup

```bash
npm install
```

## Compile

```bash
npm run build
```

## Deploy to Polygon Amoy

1. Copy environment template:

```bash
cp .env.example .env
```

2. Fill in `.env`:
- `AMOY_RPC_URL`: Polygon Amoy RPC URL
- `DEPLOYER_PRIVATE_KEY`: private key of deployer wallet (test wallet only)

3. Deploy:

```bash
npm run deploy:amoy
```

## Contract

- `contracts/VoteGuardNational.sol`
  - Region key: `regionKey(stateId, constituencyId)`
  - Verified voter gate: `setVerifiedVoter(address,bool)` (call from your KYC/verifier backend)
  - Vote: `vote(stateId,constituencyId,candidateId)`
## 🎥 Demo Video

[![VoteGuard Demo](https://img.youtube.com/vi/otAQHkG9zdg/0.jpg)](https://youtu.be/otAQHkG9zdg?si=cWCA6qAC8Gyap7fQ)

> Click the thumbnail above to watch the full demo on YouTube.
