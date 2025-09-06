import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, Connection } from '@solana/web3.js';
import { db, Campaign, ParticipantInfo } from '../db/inMemoryDB';
import { MerkleTree, MerkleLeaf } from '../utils/merkleTree';
import * as idl from "../config/commi_merkle.json";
import fs from "fs";

export interface CampaignInitParams {
  launcher: string;
  mint: string;
  fund: string;
  sig: string;
}

export interface RewardDistributionParams {
  campaignId: string;
  distributions: Array<{
    address: string;
    amount: string;
  }>;
}

export interface UpdateMerkleParams {
  campaignId: string;
  newParticipants?: Array<{
    address: string;
    amount: string;
  }>;
  updateExisting?: Array<{
    address: string;
    newAmount: string;
  }>;
}

interface SolanaCommiConfig {
  distKeyFile: string,
  rpcUrl: string,
}

interface TestMintConfig {
  payerSecretKey: number[],
  payerPublicKey: string,
  mintAddress: string,
  decimals: number,
  timestamp: string
}


const solanaConfig: SolanaCommiConfig = JSON.parse(fs.readFileSync("config/solana.json", "utf-8"));
const distKey: number[] = JSON.parse(fs.readFileSync(solanaConfig.distKeyFile, "utf-8"));
const testMintConfig: TestMintConfig = JSON.parse(fs.readFileSync("config/mint-config.json", "utf-8"));
const rpcUrl = solanaConfig.rpcUrl;
const connection = new Connection(rpcUrl, "confirmed");
const distributor = Keypair.fromSecretKey(new Uint8Array(distKey));
const wallet = new anchor.Wallet(distributor);
const provider = new anchor.AnchorProvider(connection, wallet, {
  preflightCommitment: "confirmed",
});
anchor.setProvider(provider);
const program = new anchor.Program(idl, provider);

export class CampaignService {
  // Initialize campaign after launch
  async initializeCampaign(params: CampaignInitParams) {
    const { launcher, mint, fund } = params;
    const mintKey = new PublicKey(mint);
    const launcherKey = new PublicKey(launcher);

    const [campaignPDA, _campaignBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        launcherKey.toBuffer(),
        mintKey.toBuffer(),
      ],
      program.programId
    ); 
    
    // Create initial merkle tree with launcher as first participant
    const initialLeaves: MerkleLeaf[] = [{
      address: launcher,
      amount: BigInt(params.fund),
      nonce: BigInt(Math.floor(Math.random() * 1000000)),
      index: 0
    }];

    // Add placeholder leaves to match initial size (32 leaves)
    for (let i = 1; i < 32; i++) {
      initialLeaves.push({
        address: PublicKey.default.toString(),
        amount: 0n,
        nonce: BigInt(Math.floor(Math.random() * 1000000)),
        index: i
      });
    }

    const merkleTree = new MerkleTree(initialLeaves);

    // Create campaign
    const campaign: Campaign = {
      id: campaignPDA.toString(),
      launcher: launcher,
      mint,
      fund: BigInt(fund),
      merkleTree: merkleTree, // Store the tree directly in campaign
      participants: new Map(),
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Add launcher as first participant
    campaign.participants.set(launcher, {
      address: launcher,
      amount: BigInt(fund),
      nonce: initialLeaves[0].nonce,
      index: 0,
    });

    await program.methods
      .lock()
      .accounts({
        distributor: distributor.publicKey,
        campaign: campaignPDA,
        mint
      })
      .signers([distributor])
      .rpc();
    
    // sleep for 2 seconds to wait for the potential ClaimEvent
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Update onchain root
    await program.methods
      .update(Array.from(merkleTree.getRoot()), [])
      .accounts({
        distributor: distributor.publicKey,
        launcher,
        campaign: campaignPDA,
        mint
      })
      .signers([distributor])
      .rpc();
  }

  // Get campaign by ID
  getCampaign(campaignId: string): Campaign | undefined {
    return db.getCampaign(campaignId);
  }

  // Get campaign by launcher and mint
  getCampaignByPDA(launcher: string, mint: string): Campaign | undefined {
    const mintKey = new PublicKey(mint);
    const launcherKey = new PublicKey(launcher);
    const [campaignPDA, _campaignBump] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("campaign"),
        launcherKey.toBuffer(),
        mintKey.toBuffer(),
      ],
      program.programId
    ); 
    return db.getCampaign(campaignPDA.toString());
  }

  // Distribute rewards and update merkle tree
  async distributeRewards(params: RewardDistributionParams) {

    if (params.distributions.length === 0) {
      throw new Error('No distributions provided');
    }

    const campaign = db.getCampaign(params.campaignId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    const merkleTree = campaign.merkleTree; // Get tree from campaign
    if (!merkleTree) {
      throw new Error('Merkle tree not found');
    }

    // Lock the campaign
    await program.methods
      .lock()
      .accounts({
        distributor: distributor.publicKey,
        campaign: new PublicKey(campaign.id),
        mint: new PublicKey(campaign.mint),
      })
      .signers([distributor])
      .rpc();
    
    // Collect batch updates for efficient processing
    const batchUpdates: Array<{ index: number; amount: bigint }> = [];
    const newParticipants: Array<{ dist: any; participant: ParticipantInfo }> = [];

    // Process distributions
    for (const dist of params.distributions) {
      const existingParticipant = campaign.participants.get(dist.address);
      
      if (existingParticipant) {
        // Update existing participant
        const newAmount = existingParticipant.amount + BigInt(dist.amount);
        db.updateParticipantReward(params.campaignId, dist.address, newAmount);
        batchUpdates.push({ index: existingParticipant.index, amount: newAmount });
      } else {
        // Find next available index
        let nextIndex = campaign.participants.size;
        
        // Add new participant
        const participant: ParticipantInfo = {
          address: dist.address,
          amount: BigInt(dist.amount),
          nonce: BigInt(Math.floor(Math.random() * 1000000)),
          index: nextIndex,
        };
        
        db.addParticipant(params.campaignId, participant);
        newParticipants.push({ dist, participant });
      }

      // Track distribution
      db.addDistribution({
        campaignId: params.campaignId,
        participantAddress: dist.address,
        amount: BigInt(dist.amount),
        timestamp: new Date()
      });
    }

    // Handle new participants first
    for (const { participant } of newParticipants) {
      const leaf = merkleTree.getLeaf(participant.index);
      if (leaf && leaf.address === PublicKey.default.toString()) {
        // Replace placeholder leaf
        leaf.address = participant.address;
        leaf.amount = participant.amount;
        leaf.nonce = participant.nonce;
        batchUpdates.push({ index: participant.index, amount: participant.amount });
      } else {
        // Expand tree if needed
        merkleTree.addLeaf({
          address: participant.address,
          amount: participant.amount,
          nonce: participant.nonce,
          index: participant.index
        });
      }
    }

    let cumulative_rewards = params
      .distributions
      .map(dist => dist.amount)
      .reduce((a, b) => BigInt(a) + BigInt(b), BigInt(0));
    
    

    // Apply all batch updates efficiently
    if (batchUpdates.length > 0) {
      merkleTree.batchUpdateLeaf(batchUpdates);
    }
    


    // Generate participants array for contract update
    const updated_participants = merkleTree.generateParticipantsUpdate()
      .map(([idx, amount]) => [idx.toString(), amount.toString()]);


  }

  // Update merkle tree with new participants or amounts
  async updateMerkleTree(params: UpdateMerkleParams): Promise<{
    merkleRoot: string;
    treeSize: number;
    needsExtension: boolean;
  }> {
    const campaign = db.getCampaign(params.campaignId);
    if (!campaign) {
      throw new Error('Campaign not found');
    }

    const merkleTree = campaign.merkleTree; // Get tree from campaign
    if (!merkleTree) {
      throw new Error('Merkle tree not found');
    }

    let needsExtension = false;
    const currentSize = merkleTree.getSize();

    // Add new participants
    if (params.newParticipants) {
      const requiredSize = campaign.participants.size + params.newParticipants.length;
      if (requiredSize > currentSize) {
        // Need to extend the tree
        needsExtension = true;
        const newSize = Math.max(requiredSize, currentSize + 100); // Add buffer
        merkleTree.expand(newSize);
      }

      for (const newParticipant of params.newParticipants) {
        const index = campaign.participants.size;
        const participant: ParticipantInfo = {
          address: newParticipant.address,
          amount: BigInt(newParticipant.amount),
          nonce: BigInt(Math.floor(Math.random() * 1000000)),
          index,
        };
        
        db.addParticipant(params.campaignId, participant);
        
        const leaf = merkleTree.getLeaf(index);
        if (leaf) {
          leaf.address = newParticipant.address;
          leaf.amount = BigInt(newParticipant.amount);
          leaf.nonce = participant.nonce;
        }
      }
    }

    // Update existing participants using batch update
    if (params.updateExisting) {
      const batchUpdates: Array<{ index: number; amount: bigint }> = [];
      
      for (const update of params.updateExisting) {
        const participant = campaign.participants.get(update.address);
        if (participant && !participant.claimed) {
          const newAmount = BigInt(update.newAmount);
          db.updateParticipantReward(params.campaignId, update.address, newAmount);
          batchUpdates.push({ index: participant.index, amount: newAmount });
        }
      }
      
      // Apply batch updates efficiently
      if (batchUpdates.length > 0) {
        merkleTree.batchUpdateLeaf(batchUpdates);
      }
    }

    // Generate new merkle root
    const newMerkleRoot = merkleTree.getRoot();
    
    // Update campaign
    db.updateCampaign(params.campaignId, {
      merkleRoot: newMerkleRoot
    });

    return {
      merkleRoot: newMerkleRoot.toString('hex'),
      treeSize: merkleTree.getSize(),
      needsExtension
    };
  }

  // Get merkle proof for a participant
  getMerkleProof(campaignId: string, address: string): {
    proof: string[];
    leaf: {
      address: string;
      amount: string;
      nonce: string;
      index: number;
    };
  } | null {
    const campaign = db.getCampaign(campaignId);
    if (!campaign) return null;

    const participant = campaign.participants.get(address);
    if (!participant) return null;

    const merkleTree = campaign.merkleTree; // Get tree from campaign
    if (!merkleTree) return null;

    const proof = merkleTree.getProof(participant.index);
    
    return {
      proof: proof.map(p => p.toString('hex')),
      leaf: {
        address: participant.address,
        amount: participant.amount.toString(),
        nonce: participant.nonce.toString(),
        index: participant.index
      }
    };
  }

  // Get campaign statistics
  getCampaignStats(campaignId: string) {
    const campaign = db.getCampaign(campaignId);
    if (!campaign) return null;

    const totalParticipants = campaign.participants.size;
    const claimedCount = Array.from(campaign.participants.values())
      .filter(p => p.claimed).length;
    const totalDistributed = Array.from(campaign.participants.values())
      .reduce((sum, p) => sum + p.amount, 0n);
    const totalClaimed = Array.from(campaign.participants.values())
      .filter(p => p.claimed)
      .reduce((sum, p) => sum + p.amount, 0n);

    return {
      campaignId,
      launcher: campaign.launcher,
      mint: campaign.mint,
      fund: campaign.fund.toString(),
      totalParticipants,
      claimedCount,
      unclaimedCount: totalParticipants - claimedCount,
      totalDistributed: totalDistributed.toString(),
      totalClaimed: totalClaimed.toString(),
      totalUnclaimed: (totalDistributed - totalClaimed).toString(),
      merkleRoot: campaign.merkleRoot.toString('hex'),
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt
    };
  }

  // Get all campaigns
  getAllCampaigns() {
    return db.getAllCampaigns().map(campaign => ({
      id: campaign.id,
      launcher: campaign.launcher,
      mint: campaign.mint,
      fund: campaign.fund.toString(),
      participants: campaign.participants.size,
      createdAt: campaign.createdAt,
      updatedAt: campaign.updatedAt
    }));
  }
}

export const campaignService = new CampaignService();