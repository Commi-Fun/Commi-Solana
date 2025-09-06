import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { campaignService } from './services/campaignService';
import { db } from './db/inMemoryDB';

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Error handler middleware
const errorHandler = (err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(err.stack);
  res.status(500).json({ error: err.message || 'Internal server error' });
};

// Health check
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'healthy',
    timestamp: new Date().toISOString(),
    stats: db.getStats()
  });
});

// Campaign endpoints

// Initialize campaign after on-chain launch
app.post('/campaigns/initialize', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { tx, launcher, mint, fund } = req.body;
    
    if (!tx) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const campaign = campaignService.initializeCampaign({
      launcher,
      mint,
      fund,
      merkleRoot,
      initialRewards
    });

    res.json({
      success: true,
      campaign: {
        id: campaign.id,
        launcher: campaign.launcher,
        mint: campaign.mint,
        fund: campaign.fund.toString()
      }
    });
  } catch (error) {
    next(error);
  }
});

// Get campaign by ID
app.get('/campaigns/:id', (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaign = campaignService.getCampaign(req.params.id);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const stats = campaignService.getCampaignStats(req.params.id);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Get campaign by launcher and mint
app.get('/campaigns/pda/:launcher/:mint', (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaign = campaignService.getCampaignByPDA(req.params.launcher, req.params.mint);
    
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    const stats = campaignService.getCampaignStats(campaign.id);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Get all campaigns
app.get('/campaigns', (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaigns = campaignService.getAllCampaigns();
    res.json(campaigns);
  } catch (error) {
    next(error);
  }
});

// Distribute rewards
app.post('/campaigns/:id/distribute', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { distributions } = req.body;
    
    if (!distributions || !Array.isArray(distributions)) {
      return res.status(400).json({ error: 'Invalid distributions array' });
    }

    const result = await campaignService.distributeRewards({
      campaignId: req.params.id,
      distributions
    });

    res.json({
      success: true,
      merkleRoot: result.merkleRoot,
      participants: result.participants,
      proofsAvailable: result.proofs.size
    });
  } catch (error) {
    next(error);
  }
});

// Update merkle tree
app.post('/campaigns/:id/update-merkle', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { newParticipants, updateExisting } = req.body;
    
    const result = await campaignService.updateMerkleTree({
      campaignId: req.params.id,
      newParticipants,
      updateExisting
    });

    res.json({
      success: true,
      ...result
    });
  } catch (error) {
    next(error);
  }
});

// Get merkle proof for participant
app.get('/campaigns/:id/proof/:address', (req: Request, res: Response, next: NextFunction) => {
  try {
    const proof = campaignService.getMerkleProof(req.params.id, req.params.address);
    
    if (!proof) {
      return res.status(404).json({ error: 'Participant not found' });
    }

    res.json(proof);
  } catch (error) {
    next(error);
  }
});

// Mark as claimed
app.post('/campaigns/:id/claim/:address', (req: Request, res: Response, next: NextFunction) => {
  try {
    const success = campaignService.markAsClaimed(req.params.id, req.params.address);
    
    if (!success) {
      return res.status(404).json({ error: 'Campaign or participant not found' });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Get distributions for a campaign
app.get('/campaigns/:id/distributions', (req: Request, res: Response) => {
  const distributions = db.getDistributions(req.params.id);
  res.json(distributions.map(d => ({
    campaignId: d.campaignId,
    participantAddress: d.participantAddress,
    amount: d.amount.toString(),
    timestamp: d.timestamp
  })));
});

// Batch distribute rewards (simulate multiple distributions)
app.post('/campaigns/:id/batch-distribute', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { batches } = req.body;
    
    if (!batches || !Array.isArray(batches)) {
      return res.status(400).json({ error: 'Invalid batches array' });
    }

    const results = [];
    
    for (const batch of batches) {
      const result = await campaignService.distributeRewards({
        campaignId: req.params.id,
        distributions: batch.distributions
      });
      results.push({
        batchId: batch.id || Math.random().toString(36).substring(7),
        merkleRoot: result.merkleRoot,
        participantsUpdated: result.participants.length
      });
    }

    res.json({
      success: true,
      batches: results
    });
  } catch (error) {
    next(error);
  }
});

// Debug endpoint - get full campaign data
app.get('/debug/campaign/:id', (req: Request, res: Response) => {
  const campaign = db.getCampaign(req.params.id);
  if (!campaign) {
    return res.status(404).json({ error: 'Campaign not found' });
  }

  res.json({
    campaign: {
      ...campaign,
      fund: campaign.fund.toString(),
      rewards: campaign.rewards.map(r => r.toString()),
      merkleRoot: campaign.merkleRoot.toString('hex'),
      participants: Array.from(campaign.participants.entries()).map(([address, info]) => ({
        address,
        amount: info.amount.toString(),
        nonce: info.nonce.toString(),
        index: info.index,
        claimed: info.claimed
      }))
    }
  });
});

// Clear database (for testing)
app.delete('/debug/clear', (req: Request, res: Response) => {
  db.clear();
  res.json({ success: true, message: 'Database cleared' });
});

// Apply error handler
app.use(errorHandler);

// Start server
app.listen(PORT, () => {
  console.log(`Backend server running on http://localhost:${PORT}`);
  console.log('Available endpoints:');
  console.log('  POST   /campaigns/initialize');
  console.log('  GET    /campaigns');
  console.log('  GET    /campaigns/:id');
  console.log('  GET    /campaigns/pda/:launcher/:mint');
  console.log('  POST   /campaigns/:id/distribute');
  console.log('  POST   /campaigns/:id/update-merkle');
  console.log('  GET    /campaigns/:id/proof/:address');
  console.log('  POST   /campaigns/:id/claim/:address');
  console.log('  GET    /campaigns/:id/distributions');
  console.log('  POST   /campaigns/:id/batch-distribute');
  console.log('  GET    /debug/campaign/:id');
  console.log('  DELETE /debug/clear');
});