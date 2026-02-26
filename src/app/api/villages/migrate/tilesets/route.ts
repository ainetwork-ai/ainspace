import { NextRequest, NextResponse } from 'next/server';
import { getAllVillages, updateVillage, VillageMetadata } from '@/lib/village-redis';
import {
  uploadSharedTileset,
  uploadVillageTmj,
  getRootTilesetBaseUrl,
  listSharedTilesets,
} from '@/lib/gcs';
import { getFirebaseStorage } from '@/lib/firebase';
import { rewriteTmjTilesetPaths } from '@/lib/tmj-rewriter';

/**
 * TMJ의 tileset 엔트리에서 파일명을 추출한다.
 */
function extractTilesetFileNames(tmjJson: { tilesets: { source?: string; image?: string }[] }): string[] {
  const names: string[] = [];
  for (const ts of tmjJson.tilesets) {
    const path = ts.source || ts.image;
    if (path) {
      const fileName = path.split('/').pop();
      if (fileName) names.push(fileName);
    }
  }
  return names;
}

/**
 * 마을의 tilesetBaseUrl이 이미 루트(공유) 경로인지 확인한다.
 */
function isAlreadyMigrated(village: VillageMetadata, rootBaseUrl: string): boolean {
  return village.tilesetBaseUrl === rootBaseUrl;
}

/**
 * POST /api/villages/migrate/tilesets
 *
 * 기존 마을별 타일셋을 공유 타일셋(common/tilesets/)으로 마이그레이션한다.
 * - TMJ의 tileset 경로를 공유 경로로 리라이트
 * - 타일셋 파일을 common/tilesets/에 복사
 * - Redis의 tilesetBaseUrl을 루트 경로로 업데이트
 *
 * Body (JSON):
 *   - slugs?: string[]   — 미지정 시 전체 마을
 *   - dryRun?: boolean   — true면 실제 변경 없이 결과만 반환
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const { slugs, dryRun = false } = body as { slugs?: string[]; dryRun?: boolean };

    const storage = getFirebaseStorage();
    const bucket = storage.bucket();
    const bucketName = bucket.name;
    const rootBaseUrl = getRootTilesetBaseUrl(bucketName);

    // 1. 대상 마을 목록 조회
    const allVillages = await getAllVillages();
    const targets = slugs
      ? allVillages.filter(v => slugs.includes(v.slug))
      : allVillages;

    // 공유 타일셋 현재 목록 (중복 업로드 방지용)
    const existingShared = await listSharedTilesets();
    const existingSharedNames = new Set(existingShared.map(f => f.fileName));

    const migrated: string[] = [];
    const skipped: string[] = [];
    const failed: { slug: string; error: string }[] = [];

    for (const village of targets) {
      try {
        // 2. 이미 마이그레이션된 마을 스킵
        if (isAlreadyMigrated(village, rootBaseUrl)) {
          skipped.push(village.slug);
          continue;
        }

        // TMJ URL이 없으면 스킵
        if (!village.tmjUrl) {
          skipped.push(village.slug);
          continue;
        }

        // 3a. TMJ 다운로드
        const tmjResponse = await fetch(village.tmjUrl);
        if (!tmjResponse.ok) {
          failed.push({ slug: village.slug, error: `Failed to fetch TMJ: ${tmjResponse.status}` });
          continue;
        }
        const tmjJson = await tmjResponse.json();

        // 3b. TMJ에서 타일셋 파일명 추출
        const fileNames = extractTilesetFileNames(tmjJson);

        if (!dryRun) {
          // 3c. 기존 경로에서 타일셋 파일 다운로드 → 3d. common/tilesets/에 업로드
          for (const fileName of fileNames) {
            if (existingSharedNames.has(fileName)) {
              continue; // 이미 공유 저장소에 존재
            }

            // 기존 마을별 타일셋 경로에서 다운로드
            const oldPath = `villages/${village.slug}/tilesets/${fileName}`;
            const file = bucket.file(oldPath);
            const [exists] = await file.exists();

            if (exists) {
              const [buffer] = await file.download();
              await uploadSharedTileset(buffer, fileName);
              existingSharedNames.add(fileName); // 이후 마을에서 중복 방지
            }
          }

          // 3e. TMJ tileset 경로 리라이트 (uploadedFileNames=[] → 전부 공유로 판별)
          const rewrittenTmj = await rewriteTmjTilesetPaths(tmjJson, [], village.slug);

          // 3f. 리라이트된 TMJ를 GCS에 재업로드
          const tmjBuffer = Buffer.from(rewrittenTmj);
          const newTmjUrl = await uploadVillageTmj(village.slug, tmjBuffer);

          // 3g. Redis의 tilesetBaseUrl을 루트 경로로 업데이트
          await updateVillage(village.slug, {
            tmjUrl: newTmjUrl,
            tilesetBaseUrl: rootBaseUrl,
          });
        }

        migrated.push(village.slug);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        failed.push({ slug: village.slug, error: message });
      }
    }

    return NextResponse.json({
      success: true,
      dryRun,
      migrated,
      skipped,
      failed,
    });
  } catch (error) {
    console.error('Error in POST /api/villages/migrate/tilesets:', error);
    const message = error instanceof Error ? error.message : 'Migration failed';
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 },
    );
  }
}
