# Commi-Merkle Process Flow

## System Architecture Overview

```mermaid
sequenceDiagram
    participant Client as Client/Frontend
    participant Backend as Backend Server (Distributor)
    participant Program as Solana Program
    participant Blockchain as Solana Blockchain

    Note over Client,Blockchain: Backend acts as Distributor for all merkle operations
```

## 1. Launch Campaign Flow

```mermaid
sequenceDiagram
    participant L as Launcher (Client)
    participant B as Backend (Distributor)
    participant P as Solana Program
    participant BC as Blockchain

    L->>L: Prepare campaign parameters<br/>(fund amount, backend as distributor)
    
    L->>P: Call launch() instruction
    Note over L,P: Includes: fund amount, distributor (backend),<br/>mint, launcher ATA
    
    P->>P: Validate fund >= 10000
    P->>P: Calculate service fee ($5 in SOL)
    P->>P: Transfer service fee to distributor
    P->>P: Create campaign PDA account
    P->>P: Initialize campaign state:<br/>- Set locked = 0<br/>- Set rewards[0] = fund<br/>- Store distributor, launcher, mint
    P->>P: Transfer tokens to vault
    
    P->>BC: Emit LaunchEvent
    BC-->>L: Transaction confirmed
    
    BC-->>B: Listen for LaunchEvent
    B->>B: Detect new campaign
    B->>B: Prepare initial merkle tree<br/>(launcher with full amount)
    
    B->>P: Call lock() instruction
    P->>P: Set campaign.locked = 1
    P-->>B: Lock confirmed
    
    B->>B: Generate merkle root
    B->>P: Call update() instruction
    Note over B,P: Set initial merkle root
    P->>P: Update merkle_root
    P->>P: Automatically unlock (locked = 0)
    P->>BC: Emit UpdateEvent
    
    BC-->>B: Update confirmed
    B->>B: Campaign ready for operations
```

## 2. Update Merkle Root Flow (Backend-Driven)

```mermaid
sequenceDiagram
    participant C as Client/Admin
    participant B as Backend (Distributor)
    participant P as Solana Program
    participant BC as Blockchain

    Note over C,B: Trigger for update (e.g., new allocations)
    C->>B: Request allocation update<br/>(new participants/amounts)
    
    B->>B: Validate allocation request
    B->>B: Calculate participant rewards
    
    B->>P: Call lock() instruction
    Note over B,P: Backend is the distributor
    P->>P: Validate distributor signature
    P->>P: Set campaign.locked = 1
    P-->>B: Lock confirmed
    
    Note over B,P: Campaign locked,<br/>claims prevented
    
    B->>B: Generate new merkle tree<br/>with updated allocations
    B->>B: Calculate merkle root
    B->>B: Prepare participants array<br/>[[idx, amount], ...]
    
    B->>P: Call update() instruction
    Note over B,P: Includes: new merkle root,<br/>participants array
    
    P->>P: Validate distributor signature
    P->>P: Calculate total new rewards
    P->>P: Subtract from rewards[0] (funder)
    P->>P: Add to each participant's rewards[idx]
    P->>P: Update merkle_root
    P->>P: Automatically unlock (locked = 0)
    
    P->>BC: Emit UpdateEvent
    BC-->>B: Transaction confirmed
    
    B->>B: Update database with new tree
    B->>B: Store participant proofs
    B->>B: Notify eligible claimers<br/>(optional)
    
    B-->>C: Update complete
```

## 3. Claim Tokens Flow

```mermaid
sequenceDiagram
    participant C as Claimer (Client)
    participant B as Backend
    participant P as Solana Program
    participant BC as Blockchain

    C->>B: Request claim info<br/>(claimer address)
    
    B->>B: Look up claimer in merkle tree
    B->>B: Check if already claimed
    B->>B: Generate merkle proof
    B->>B: Get user_idx and nonce
    
    B-->>C: Return claim parameters<br/>(user_idx, proof, nonce, amount)
    
    C->>P: Call claim() instruction
    Note over C,P: Includes: user_idx, proof array,<br/>nonce, claimer ATA
    
    P->>P: Check campaign.locked == 0<br/>(fail if locked)
    P->>P: Verify rewards[user_idx] > 0
    P->>P: Calculate leaf hash:<br/>hash(claimer, amount, idx, nonce)
    P->>P: Verify merkle proof<br/>against campaign.merkle_root
    P->>P: Transfer tokens from vault<br/>to claimer ATA
    P->>P: Set rewards[user_idx] = 0<br/>(prevent double claims)
    
    P->>BC: Emit ClaimEvent
    BC-->>C: Transaction confirmed
    
    BC-->>B: Listen for ClaimEvent
    B->>B: Update claim status in database
    B->>B: Mark user as claimed
```

## Backend as Distributor Architecture

```mermaid
flowchart TB
    subgraph "Backend Services (Distributor)"
        API[API Server]
        DB[(Database)]
        MT[Merkle Tree<br/>Generator]
        EL[Event Listener]
        WM[Wallet Manager<br/>Distributor Key]
    end
    
    subgraph "Solana Program"
        CS[Campaign State]
        MR[Merkle Root]
        RW[Rewards Array]
        VT[Token Vault]
        LK[Lock State]
    end
    
    subgraph "Clients"
        L[Launcher]
        C[Claimers]
    end
    
    L -->|1. Launch| CS
    EL -->|2. Detect Launch| DB
    WM -->|3. Lock| LK
    MT -->|4. Generate Tree| MR
    WM -->|5. Update| RW
    
    C -->|6. Request Proof| API
    DB -->|7. Proof Data| C
    C -->|8. Claim| VT
    EL -->|9. Track Claim| DB
```

## State Transitions with Backend Control

```mermaid
stateDiagram-v2
    [*] --> Uninitialized
    
    Uninitialized --> Launched: Launcher: launch()
    
    state "Backend Operations" {
        Launched --> Initializing: Backend: Detect event
        Initializing --> Locked_Init: Backend: lock()
        Locked_Init --> Ready: Backend: update(initial_root)
        
        Ready --> Locked_Update: Backend: lock()
        Locked_Update --> Ready: Backend: update(new_root)
    }
    
    Ready --> Claiming: Claimer: claim()
    Claiming --> Ready: Success
    
    note right of Locked_Init
        Backend locks after launch
        to set initial merkle root
    end note
    
    note right of Locked_Update
        Backend locks before
        any merkle update
    end note
    
    note right of Ready
        Unlocked state
        Claims allowed
    end note
```

## Backend Event Processing Flow

```mermaid
flowchart LR
    subgraph "Event Processing"
        LE[Launch Event]
        UE[Update Event]
        CE[Claim Event]
    end
    
    subgraph "Backend Actions"
        IL[Initialize & Lock]
        GM[Generate Merkle]
        UM[Update Merkle]
        UC[Update Claims DB]
    end
    
    LE --> IL
    IL --> GM
    GM --> UM
    
    UE --> UC
    CE --> UC
    
    style LE fill:#f9f,stroke:#333,stroke-width:2px
    style UE fill:#9ff,stroke:#333,stroke-width:2px
    style CE fill:#ff9,stroke:#333,stroke-width:2px
```

## Security Flow with Backend as Distributor

```mermaid
sequenceDiagram
    participant Anyone
    participant Backend as Backend (Authorized)
    participant Program

    Note over Anyone,Program: Only Backend can lock/update
    
    Anyone->>Program: Attempt lock()
    Program->>Program: Check signer == distributor
    Program--xAnyone: InvalidDistributor error
    
    Backend->>Program: Call lock()
    Program->>Program: Check signer == distributor ✓
    Program->>Program: Set locked = 1
    Program-->>Backend: Success
    
    Note over Backend,Program: Backend has exclusive<br/>merkle update rights
```

## Complete Operation Lifecycle

```mermaid
flowchart TD
    Start([Start])
    
    Launch[Launcher: launch campaign]
    Listen[Backend: Listen for event]
    Lock1[Backend: lock()]
    Init[Backend: Generate initial merkle]
    Update1[Backend: update with initial root]
    
    Ready{Campaign Ready}
    
    NewAlloc[New Allocations Needed?]
    Lock2[Backend: lock()]
    Compute[Backend: Compute new merkle]
    Update2[Backend: update with new root]
    
    ClaimReq[User: Request claim info]
    GetProof[Backend: Provide proof]
    Claim[User: claim tokens]
    Track[Backend: Track claim]
    
    Start --> Launch
    Launch --> Listen
    Listen --> Lock1
    Lock1 --> Init
    Init --> Update1
    Update1 --> Ready
    
    Ready --> NewAlloc
    NewAlloc -->|Yes| Lock2
    Lock2 --> Compute
    Compute --> Update2
    Update2 --> Ready
    
    Ready --> ClaimReq
    ClaimReq --> GetProof
    GetProof --> Claim
    Claim --> Track
    Track --> Ready
    
    NewAlloc -->|No| ClaimReq
```

## Key Points (Updated)

1. **Launch Phase**:
   - Launcher creates campaign with backend as distributor
   - Backend immediately detects launch event
   - Backend locks campaign and sets initial merkle root
   - Campaign becomes ready for operations

2. **Backend as Distributor**:
   - Only backend can call lock() and update()
   - Backend manages all merkle tree operations
   - Backend stores distributor private key securely
   - Backend tracks all campaign events

3. **Update Phase**:
   - Backend locks before any merkle update
   - Backend computes new allocations and merkle tree
   - Update automatically unlocks after completion
   - Funder's balance (rewards[0]) reduced by allocated amounts

4. **Claim Phase**:
   - Users request claim info from backend
   - Backend provides merkle proof and parameters
   - Claims blocked when campaign is locked
   - Backend tracks successful claims via events

5. **Security Features**:
   - Only backend (as distributor) can modify merkle roots
   - Atomic lock-update-unlock pattern prevents race conditions
   - Backend controls all allocation logic
   - On-chain verification ensures claim validity