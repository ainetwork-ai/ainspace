import { NextRequest, NextResponse } from 'next/server';
import { GoogleAuth } from 'google-auth-library';

/**
 * POST /api/map/generate-tile
 * Vertex AI Imagen 3.0을 사용하여 기존 타일맵 이미지를 기반으로 빈 영역을 채움
 */
export async function POST(request: NextRequest) {
  try {
    const { contextImage, maskImage, emptyPositions, gridSize, worldPosition, prompt } = await request.json();

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
