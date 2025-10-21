import { NextRequest, NextResponse } from 'next/server';
import { getJob, deleteJob } from '@/lib/jobManager';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const jobId = searchParams.get('jobId');

  if (!jobId) {
    return NextResponse.json({ error: 'Job ID is required' }, { status: 400 });
  }

  const job = getJob(jobId);

  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  // Clean up completed jobs after 1 hour
  if (job.status === 'completed' || job.status === 'failed') {
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (job.createdAt < hourAgo) {
      deleteJob(jobId);
      return NextResponse.json({ error: 'Job expired' }, { status: 404 });
    }
  }

  return NextResponse.json({
    jobId,
    status: job.status,
    result: job.result,
    error: job.error
  });
}