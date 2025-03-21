import { NextRequest, NextResponse } from 'next/server';
import { RewardService } from '@/services/reward-service';
import { validateRequestBody } from '@/utils/api-validation';

// Schema for request validation
const prepareClaimSchema = {
  type: 'object',
  required: ['chainId', 'assetId', 'rewardId', 'airdropId', 'userAddress'],
  properties: {
    chainId: { type: 'number' },
    assetId: { type: 'number' },
    rewardId: { type: 'number' },
    airdropId: { type: 'number' },
    userAddress: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' }
  }
};

export async function POST(request: NextRequest) {
  try {
    // Parse request body
    const body = await request.json();
    
    // Validate request
    const validationResult = validateRequestBody(body, prepareClaimSchema);
    if (!validationResult.valid) {
      return NextResponse.json(
        { error: 'Invalid request', details: validationResult.errors },
        { status: 400 }
      );
    }
    
    const { chainId, assetId, rewardId, airdropId, userAddress } = body;
    
    // Initialize service
    const rewardService = new RewardService();
    
    // Prepare claim
    const claimData = await rewardService.prepareRewardClaim(
      chainId,
      assetId,
      rewardId,
      airdropId,
      userAddress
    );
    
    // Return claim data
    return NextResponse.json(claimData);
  } catch (error) {
    console.error('Error preparing claim:', error);
    
    // Determine status code based on error
    let statusCode = 500;
    let errorMessage = 'Internal server error';
    
    if (error instanceof Error) {
      if (error.message.includes('Reward not found')) {
        statusCode = 404;
        errorMessage = error.message;
      } else if (error.message.includes('Reward already')) {
        statusCode = 409; // Conflict
        errorMessage = error.message;
      } else if (error.message.includes('Airdrop is not')) {
        statusCode = 400;
        errorMessage = error.message;
      }
    }
    
    return NextResponse.json(
      { error: errorMessage },
      { status: statusCode }
    );
  }
}

// Rate limiting middleware could be added here
export const config = {
  api: {
    // Configure rate limiting for this route
    // e.g. 10 requests per minute per IP
    // This requires additional setup with a rate limiting library
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};