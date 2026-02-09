import { getFirebaseStorage } from './firebase';

const VILLAGE_MAPS_PATH = 'villages';

/**
 * 마을 맵 파일(TMJ)을 GCS에 업로드한다.
 */
export async function uploadVillageMapFile(
  slug: string,
  fileBuffer: Buffer,
  fileName: string,
  contentType: string,
): Promise<string> {
  const storage = getFirebaseStorage();
  const bucket = storage.bucket();
  const filePath = `${VILLAGE_MAPS_PATH}/${slug}/${fileName}`;
  const file = bucket.file(filePath);

  await file.save(fileBuffer, {
    metadata: {
      contentType,
      cacheControl: 'public, max-age=3600',
    },
  });

  return `https://storage.googleapis.com/${bucket.name}/${filePath}`;
}

/**
 * 마을 TMJ 파일을 업로드한다.
 */
export async function uploadVillageTmj(
  slug: string,
  tmjBuffer: Buffer,
): Promise<string> {
  return uploadVillageMapFile(slug, tmjBuffer, 'map.tmj', 'application/json');
}

/**
 * 마을 타일셋 이미지를 업로드한다.
 */
export async function uploadVillageTileset(
  slug: string,
  imageBuffer: Buffer,
  fileName: string,
): Promise<string> {
  const contentType = fileName.endsWith('.png') ? 'image/png' : 'image/webp';
  return uploadVillageMapFile(slug, imageBuffer, `tilesets/${fileName}`, contentType);
}

/**
 * 마을 TSX 파일을 업로드한다.
 */
export async function uploadVillageTsx(
  slug: string,
  tsxBuffer: Buffer,
  fileName: string,
): Promise<string> {
  return uploadVillageMapFile(slug, tsxBuffer, `tilesets/${fileName}`, 'application/xml');
}

/**
 * 마을의 타일셋 베이스 URL을 반환한다.
 */
export function getVillageTilesetBaseUrl(bucketName: string, slug: string): string {
  return `https://storage.googleapis.com/${bucketName}/${VILLAGE_MAPS_PATH}/${slug}/tilesets`;
}

/**
 * 마을 관련 GCS 파일을 모두 삭제한다.
 */
export async function deleteVillageFiles(slug: string): Promise<void> {
  const storage = getFirebaseStorage();
  const bucket = storage.bucket();
  const prefix = `${VILLAGE_MAPS_PATH}/${slug}/`;

  const [files] = await bucket.getFiles({ prefix });
  if (files.length > 0) {
    await Promise.all(files.map(file => file.delete()));
  }
}
