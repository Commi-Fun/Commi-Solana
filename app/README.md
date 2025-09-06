# Commi-Merkle Backend Server

A backend server for managing off-chain state and merkle tree operations for the commi-merkle Solana program.

## Installation & Setup

From the project root:

```bash
npm install
```

## Running the Server

### Development Mode
```bash
npm run app:dev
```

### Production Mode
```bash
npm run build
npm run app:start
```

## Testing

```bash
npm run app:test
```

## Features

- **Campaign Management**: Initialize and manage campaigns after on-chain launch
- **In-Memory Database**: Simulates database operations for development/testing
- **Optimized Merkle Tree Operations**: 
  - O(log n) single leaf updates
  - Efficient batch updates to avoid overlapping calculations
  - Complete merkle tree stored in campaign for better synchronization
- **Reward Distribution**: Track and manage reward distributions to participants
- **Proof Generation**: Generate merkle proofs for claiming rewards

## API Endpoints

### Campaign Management

#### Initialize Campaign
`POST /campaigns/initialize`

Initialize a campaign after on-chain launch.

Request body:
```json
{
  "launcher": "wallet_address",
  "mint": "token_mint_address",
  "fund": "1000000000",
  "merkleRoot": "hex_string",
  "initialRewards": ["1000000000", "0", "0", ...]
}
```

#### Get Campaign
`GET /campaigns/:id`

Get campaign details and statistics.

#### Get All Campaigns
`GET /campaigns`

List all campaigns.

### Reward Distribution

#### Distribute Rewards
`POST /campaigns/:id/distribute`

Distribute rewards to participants and update merkle tree using optimized batch operations.

Request body:
```json
{
  "distributions": [
    {
      "address": "participant_wallet",
      "amount": "100000000"
    }
  ]
}
```

#### Batch Distribute
`POST /campaigns/:id/batch-distribute`

Process multiple distribution batches efficiently.

### Merkle Operations

#### Update Merkle Tree
`POST /campaigns/:id/update-merkle`

Update merkle tree with new participants or amounts using batch operations.

#### Get Merkle Proof
`GET /campaigns/:id/proof/:address`

Get merkle proof for a participant to claim rewards.

## Architecture Improvements

### Performance Optimizations

1. **O(log n) Leaf Updates**: Single leaf updates now only recalculate the path to root instead of rebuilding the entire tree
2. **Batch Operations**: Multiple updates are processed together to avoid redundant hash calculations
3. **Integrated Storage**: Merkle trees are stored directly in campaign objects, eliminating synchronization issues

### Data Structure

- Campaign objects now contain the complete MerkleTree instance
- Removed separate MerkleTreeManager for simplified architecture
- All operations work directly with the tree stored in the campaign

## Usage Examples

### 1. Initialize a Campaign

```bash
curl -X POST http://localhost:3000/campaigns/initialize \
  -H "Content-Type: application/json" \
  -d '{
    "launcher": "5PpeUwd8XqJ4y75gEM3ATrmaV4piR9GdZhpuFhH76UGw",
    "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "fund": "1000000000",
    "merkleRoot": "abc123...",
    "initialRewards": ["1000000000", "0", "0", ...]
  }'
```

### 2. Batch Distribute Rewards

```bash
curl -X POST http://localhost:3000/campaigns/CAMPAIGN_ID/distribute \
  -H "Content-Type: application/json" \
  -d '{
    "distributions": [
      {
        "address": "USER_WALLET_1",
        "amount": "100000000"
      },
      {
        "address": "USER_WALLET_2", 
        "amount": "200000000"
      }
    ]
  }'
```

This will efficiently process all distributions in a single batch operation, minimizing merkle tree recalculations.