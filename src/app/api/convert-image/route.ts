import { NextRequest, NextResponse } from 'next/server';
import { ainizeInferenceConfig, editAinizeImage } from '@/lib/ainize-inference';
import { createJob, updateJobStatus } from '@/lib/jobManager';

// Generate unique job ID
function generateJobId(): string {
  return `job_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

// Async function to process the image conversion
async function processImageConversion(jobId: string, imageFile: File) {
  try {
    updateJobStatus(jobId, { status: 'processing' });

    const prompt = `Convert the provided building image into a 2D RPG style.
-No grid lines in the output.
-Style: top-down RPG look; remove perspective/foreshortening if present; keep lighting/shadows consistent.
-Background: transparent; spacing/margins = 0.
-Output: one PNG.`;

    const image = await editAinizeImage(imageFile, prompt);

    updateJobStatus(jobId, { 
      status: 'completed', 
      result: image
    });

  } catch {
    console.error('Ainize image conversion unavailable');
    updateJobStatus(jobId, {
      status: 'failed',
      error: 'Image conversion is temporarily unavailable. Please try again.'
    });
  }
}

export async function POST(request: NextRequest) {
  try {
    if (!ainizeInferenceConfig()?.imageEditModel) {
      return NextResponse.json({ error: 'Image conversion is temporarily unavailable.' }, { status: 503 });
    }
    const formData = await request.formData();
    const file = formData.get('image');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 });
    }
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 10 * 1024 * 1024) {
      return NextResponse.json({ error: 'Use a PNG, JPEG or WebP image up to 10 MB.' }, { status: 400 });
    }

    // Generate job ID and create job
    const jobId = generateJobId();
    createJob(jobId);

    // Start async processing in next tick to avoid blocking
    setImmediate(() => {
      processImageConversion(jobId, file);
    });

    // Return job ID immediately
    return NextResponse.json({ 
      success: true, 
      jobId: jobId,
      message: 'Image conversion started. Use the jobId to check status.'
    });

  } catch {
    console.error('Ainize image conversion request failed');
    return NextResponse.json({
      error: 'Failed to start image conversion'
    }, { status: 500 });
  }
}
