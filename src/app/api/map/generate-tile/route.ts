import { NextRequest, NextResponse } from 'next/server';
import { GoogleAuth } from 'google-auth-library';
import { createPublicClient, http, parseUnits } from 'viem';
import { base } from 'viem/chains';

/**
 * POST /api/map/generate-tile
 * Vertex AI Imagen 3.0을 사용하여 기존 타일맵 이미지를 기반으로 빈 영역을 채움
 * x402 payment protocol 지원
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { contextImage, maskImage, emptyPositions, gridSize, worldPosition, prompt, transactionHash } = body;

    // Calculate price based on tile count: 100 tiles = 1 AIN
    const tileCount = emptyPositions?.length || 0;
    const priceInAIN = tileCount / 100;
    const priceInWei = parseUnits(priceInAIN.toString(), 18);

    // If no transaction hash, return 402 Payment Required
    if (!transactionHash) {
      const paymentRequired = {
        x402Version: 1,
        tileCount,
        pricePerHundredTiles: '1 AIN',
        accepts: [
          {
            scheme: 'exact',
            network: 'eip155:8453', // Base mainnet
            price: `${priceInAIN} AIN`,
            payTo: process.env.PAYMENT_WALLET_ADDRESS || '0xYourWalletAddress',
            asset: process.env.AIN_TOKEN_ADDRESS || '0xAINTokenContract',
            maxAmountRequired: priceInWei.toString(), // Dynamic amount in wei (18 decimals)
            resource: '/api/map/generate-tile',
            description: `AI-generated tile expansion (${tileCount} tiles)`,
            maxTimeoutSeconds: 60
          }
        ]
      };

      const paymentRequiredBase64 = Buffer.from(JSON.stringify(paymentRequired)).toString('base64');

      return NextResponse.json(
        {
          error: 'Payment required',
          message: 'Please provide payment to generate tiles',
          tileCount,
          priceInAIN
        },
        {
          status: 402,
          headers: {
            'PAYMENT-REQUIRED': paymentRequiredBase64
          }
        }
      );
    }

    // Verify transaction on-chain
    console.log('Verifying transaction:', transactionHash);

    const publicClient = createPublicClient({
      chain: base,
      transport: http(),
    });

    const transaction = await publicClient.getTransaction({
      hash: transactionHash as `0x${string}`,
    });

    if (!transaction) {
      return NextResponse.json(
        {
          success: false,
          error: 'Transaction not found',
        },
        { status: 400 }
      );
    }

    const receipt = await publicClient.getTransactionReceipt({
      hash: transactionHash as `0x${string}`,
    });

    // Check if transaction is confirmed
    if (!receipt || receipt.status !== 'success') {
      return NextResponse.json(
        {
          success: false,
          error: 'Transaction not confirmed or failed',
        },
        { status: 400 }
      );
    }

    // Verify payment details - calculate expected amount based on tile count
    const expectedAmount = priceInWei; // Dynamic amount based on tile count
    const expectedTo = (process.env.PAYMENT_WALLET_ADDRESS || '').toLowerCase();

    // For ERC20 transfer, check the logs
    const transferLog = receipt.logs.find(log => {
      // ERC20 Transfer event signature
      return log.topics[0] === '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
    });

    if (!transferLog) {
      return NextResponse.json(
        {
          success: false,
          error: 'No transfer event found in transaction',
        },
        { status: 400 }
      );
    }

    // Decode transfer event: Transfer(address indexed from, address indexed to, uint256 value)
    const toAddress = transferLog.topics[2] ? ('0x' + transferLog.topics[2].slice(26)) : '';
    const value = transferLog.data ? BigInt(transferLog.data) : BigInt(0);

    console.log('Payment verification:', {
      tileCount,
      priceInAIN,
      to: toAddress.toLowerCase(),
      expectedTo,
      value: value.toString(),
      expectedValue: expectedAmount.toString(),
    });

    if (toAddress.toLowerCase() !== expectedTo) {
      return NextResponse.json(
        {
          success: false,
          error: 'Payment sent to wrong address',
        },
        { status: 400 }
      );
    }

    if (value < expectedAmount) {
      return NextResponse.json(
        {
          success: false,
          error: 'Insufficient payment amount',
        },
        { status: 400 }
      );
    }

    console.log('Payment verified successfully!');
    // Payment verified, proceed with tile generation

    const projectId = process.env.VERTEX_AI_PROJECT_ID || 'ainspace';
    const location = process.env.VERTEX_AI_LOCATION || 'us-central1';
    const modelId = process.env.VERTEX_AI_MODEL_ID || 'imagen-3.0-capability-001';

    console.log('Calling Vertex AI Imagen 3.0');
    console.log('Empty positions count:', emptyPositions?.length);

    // Get access token using Service Account or Application Default Credentials
    let auth: GoogleAuth;

    const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
    if (serviceAccountJson) {
      // Use service account JSON from env var
      const credentials = JSON.parse(serviceAccountJson);
      auth = new GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
    } else {
      // Fall back to Application Default Credentials (for local dev)
      auth = new GoogleAuth({
        scopes: ['https://www.googleapis.com/auth/cloud-platform'],
      });
    }

    const accessToken = await auth.getAccessToken();

    if (!accessToken) {
      return NextResponse.json({
        success: false,
        error: 'Failed to get Google Cloud access token',
      }, { status: 500 });
    }

    const apiEndpoint = `https://${location}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${location}/publishers/google/models/${modelId}:predict`;

    // Extract base64 data from data URL
    const base64Image = contextImage.replace(/^data:image\/\w+;base64,/, '');
    const base64Mask = maskImage ? maskImage.replace(/^data:image\/\w+;base64,/, '') : null;

    const imagePrompt = prompt ||
      `Fill the grey/white empty areas with 2D top-down RPG game tiles that seamlessly match the existing terrain. Pixel art style. Use grass, dirt, stone tiles that blend naturally with surrounding tiles.`;

    // Build request body for Imagen 3.0 inpainting (always with mask)
    const requestBody = {
      instances: [
        {
          prompt: imagePrompt,
          referenceImages: [
            {
              referenceType: "REFERENCE_TYPE_RAW",
              referenceId: 1,
              referenceImage: {
                bytesBase64Encoded: base64Image,
              },
            },
            {
              referenceType: "REFERENCE_TYPE_MASK",
              referenceId: 2,
              referenceImage: {
                bytesBase64Encoded: base64Mask,
              },
              maskImageConfig: {
                maskMode: "MASK_MODE_USER_PROVIDED",
                dilation: 0.01,
              },
            },
          ],
        },
      ],
      parameters: {
        editMode: "EDIT_MODE_INPAINT_INSERTION",
        baseSteps: 35,
        sampleCount: 1,
        guidanceScale: 60,
        outputOptions: {
          mimeType: "image/png",
        },
        addWatermark: false,
      },
    };

    const response = await fetch(apiEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Vertex AI Imagen API error:', errorText);
      return NextResponse.json({
        success: false,
        error: 'Failed to generate image: ' + errorText,
      }, { status: 500 });
    }

    const data = await response.json();
    console.log('Vertex AI response received');

    // Extract generated image from response
    const predictions = data.predictions;
    if (!predictions || predictions.length === 0) {
      return NextResponse.json({
        success: false,
        error: 'No predictions in response',
      }, { status: 500 });
    }

    const generatedImageB64 = predictions[0].bytesBase64Encoded;

    if (!generatedImageB64) {
      return NextResponse.json({
        success: false,
        error: 'No image generated',
      }, { status: 500 });
    }

    const generatedImage = `data:image/png;base64,${generatedImageB64}`;

    return NextResponse.json({
      success: true,
      generatedImage,
      emptyPositions,
      worldPosition,
    });
  } catch (error) {
    console.error('Error generating image:', error);
    return NextResponse.json({
      success: false,
      error: String(error),
    }, { status: 500 });
  }
}
