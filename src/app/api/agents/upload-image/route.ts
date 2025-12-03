import { NextRequest, NextResponse } from 'next/server';
import { uploadImageToBucket, deleteFileFromBucket } from '@/lib/firebase';
import { getRedisClient, StoredAgent } from '@/lib/redis';

const AGENTS_KEY = 'agents:';

/**
 * POST /api/agents/upload-image
 * Upload sprite image to Firebase Storage
 * 
 * FormData:
 * - image: File (required) - Image file to upload
 * - agentUrl: string (required) - Agent URL used for filename generation and agent update
 * 
 * Returns:
 * - spriteUrl: string - URL of the uploaded image
 * - agentUpdated: boolean - Whether the agent was updated
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const imageFile = formData.get('image') as File | null;
    const agentUrl = formData.get('agentUrl') as string | null;

    // Validate image file
    if (!imageFile || imageFile.size === 0) {
      return NextResponse.json(
        { error: 'Image file is required' },
        { status: 400 }
      );
    }

    // Validate agentUrl (required for filename generation)
    if (!agentUrl) {
      return NextResponse.json(
        { error: 'Agent URL is required' },
        { status: 400 }
      );
    }

    // Determine bucket repository based on environment
    const nodeEnv = process.env.NEXT_PUBLIC_NODE_ENV;
    const repository = nodeEnv === 'production' ? 'production' : 'develop';

    // Upload image to Firebase Storage
    const arrayBuffer = await imageFile.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);
    
    // Generate agentKey
    const agentKey = `${AGENTS_KEY}${Buffer.from(agentUrl).toString('base64')}`;
    
    // Generate filename: agentUrl base64 encoded + timestamp
    const timestamp = Date.now();
    const agentUrlBase64 = agentKey.replace(/[/+=]/g, '');
    const originalFilename = imageFile.name || 'sprite.png';
    const fileExtension = originalFilename.split('.').pop() || 'png';
    const fileName = `${repository}/sprites/${agentUrlBase64}-${timestamp}.${fileExtension}`;
    
    // Upload to Firebase Storage
    const spriteUrl = await uploadImageToBucket(
      fileBuffer,
      fileName,
      imageFile.type || 'image/png'
    );

    // Update the agent's spriteUrl
    let agentUpdated = false;
    try {
        // Try Redis first
        const redis = await getRedisClient();
        const existing = await redis.get(agentKey);
        
        if (existing) {
          const existingData: StoredAgent = JSON.parse(existing);
          
          // Delete old sprite file if exists
          if (existingData.spriteUrl) {
            try {
              const oldFileUrl = existingData.spriteUrl;
              const urlParts = oldFileUrl.split('/');
              const bucketIndex = urlParts.findIndex(part => part.includes('.appspot.com'));
              if (bucketIndex >= 0 && bucketIndex < urlParts.length - 1) {
                const oldFilePath = urlParts.slice(bucketIndex + 1).join('/');
                await deleteFileFromBucket(oldFilePath);
              }
            } catch (deleteError) {
              console.warn('Failed to delete old sprite file:', deleteError);
              // Continue even if deletion fails
            }
          }
          
          // Update agent with new spriteUrl
          const updatedData: StoredAgent = {
            ...existingData,
            spriteUrl: spriteUrl
          };
          
          await redis.set(agentKey, JSON.stringify(updatedData));
          agentUpdated = true;
          console.log(`Updated agent sprite in Redis: ${agentUrl}`);
        } else {
          return NextResponse.json(
            { error: 'Agent not found' },
            { status: 404 }
          );
        }
    } catch (updateError) {
      console.error('Failed to update agent:', updateError);
      // Still return success with spriteUrl even if agent update fails
    }

    return NextResponse.json({
      success: true,
      spriteUrl: spriteUrl,
      agentUpdated: agentUpdated,
      message: agentUpdated 
        ? 'Image uploaded and agent updated successfully' 
        : 'Image uploaded successfully'
    });

  } catch (error) {
    console.error('Error uploading image:', error);
    return NextResponse.json(
      { 
        error: 'Failed to upload image',
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

