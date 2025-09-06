import { MerkleTree } from '../utils/merkleTree';

export interface Campaign {
  id: string;
  launcher: string;
  mint: string;
  fund: bigint;
  merkleTree: MerkleTree; // Store entire merkle tree
  participants: Map<string, ParticipantInfo>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ParticipantInfo {
  address: string;
  amount: bigint;
  nonce: bigint;
  index: number;
}

export interface RewardDistribution {
  campaignId: string;
  participantAddress: string;
  amount: bigint;
  timestamp: Date;
}

class InMemoryDatabase {
  private campaigns: Map<string, Campaign> = new Map();
  private distributions: RewardDistribution[] = [];

  // Campaign operations
  createCampaign(campaign: Campaign): Campaign {
    const id = campaign.id;
    this.campaigns.set(id, campaign);
    console.log(`Campaign created: ${id}`);
    return campaign;
  }

  getCampaign(id: string): Campaign | undefined {
    return this.campaigns.get(id);
  }

  updateCampaign(id: string, updates: Partial<Campaign>): Campaign | undefined {
    const campaign = this.campaigns.get(id);
    if (!campaign) return undefined;

    const updatedCampaign = {
      ...campaign,
      ...updates,
      updatedAt: new Date()
    };
    this.campaigns.set(id, updatedCampaign);
    return updatedCampaign;
  }

  getAllCampaigns(): Campaign[] {
    return Array.from(this.campaigns.values());
  }

  // Participant operations
  addParticipant(campaignId: string, participant: ParticipantInfo): boolean {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) return false;

    campaign.participants.set(participant.address, participant);
    campaign.updatedAt = new Date();
    return true;
  }

  getParticipant(campaignId: string, address: string): ParticipantInfo | undefined {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) return undefined;
    return campaign.participants.get(address);
  }

  updateParticipantReward(
    campaignId: string, 
    address: string, 
    newAmount: bigint
  ): boolean {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) return false;

    const participant = campaign.participants.get(address);
    if (!participant) return false;

    participant.amount = newAmount;
    campaign.updatedAt = new Date();
    return true;
  }

  markAsClaimed(campaignId: string, address: string): boolean {
    const campaign = this.campaigns.get(campaignId);
    if (!campaign) return false;

    const participant = campaign.participants.get(address);
    if (!participant) return false;

    participant.claimed = true;
    participant.amount = 0n;
    campaign.rewards[participant.index] = 0n;
    campaign.updatedAt = new Date();
    return true;
  }

  // Distribution tracking
  addDistribution(distribution: RewardDistribution): void {
    this.distributions.push(distribution);
  }

  getDistributions(campaignId?: string): RewardDistribution[] {
    if (campaignId) {
      return this.distributions.filter(d => d.campaignId === campaignId);
    }
    return this.distributions;
  }

  // Utility functions
  generateCampaignId(launcher: string, mint: string): string {
    return `${launcher}_${mint}`;
  }

  // Clear database (useful for testing)
  clear(): void {
    this.campaigns.clear();
    this.distributions = [];
  }

  // Get statistics
  getStats() {
    const totalCampaigns = this.campaigns.size;
    const totalDistributions = this.distributions.length;
    const totalParticipants = Array.from(this.campaigns.values()).reduce(
      (sum, campaign) => sum + campaign.participants.size, 
      0
    );

    return {
      totalCampaigns,
      totalDistributions,
      totalParticipants
    };
  }
}

// Singleton instance
export const db = new InMemoryDatabase();