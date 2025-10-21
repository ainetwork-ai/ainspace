import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File;
    const tileId = formData.get('tileId') as string;

    if (!file) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    if (!tileId) {
      return NextResponse.json({ error: 'No tileId provided' }, { status: 400 });
    }

    // Upload to Vercel Blob
    const blob = await put(`tiles/${tileId}.png`, file, {
      access: 'public',
      token: process.env.AINSPACE_BLOB_READ_WRITE_TOKEN,
    });

    return NextResponse.json({
      success: true,
      url: blob.url,
      tileId,
    });
  } catch (error: unknown) {
    console.error('Error uploading tile:', error);
    return NextResponse.json({
      error: error instanceof Error ? error.message : 'Failed to upload tile'
    }, { status: 500 });
  }
}
