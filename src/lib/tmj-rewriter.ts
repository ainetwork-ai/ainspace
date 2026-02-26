import { listSharedTilesets } from './gcs';

type TmjTilesetEntry = {
  firstgid: number;
  source?: string;
  image?: string;
  [key: string]: unknown;
};

type TmjJson = {
  tilesets: TmjTilesetEntry[];
  [key: string]: unknown;
};

/**
 * 파일 경로에서 파일명만 추출한다.
 * Tiled Editor가 "../" 같은 상대 경로를 포함할 수 있으므로 마지막 세그먼트만 사용.
 */
function extractFileName(path: string): string {
  return path.split('/').pop() || path;
}

/**
 * TMJ의 tileset 경로를 공유/개별로 리라이트한다.
 *
 * - uploadedFileNames에 포함된 파일 → 개별: `{slug}/tilesets/{fileName}`
 * - uploadedFileNames에 미포함 → 공유: `common/tilesets/{fileName}`
 *
 * @param tmjJson - 파싱된 TMJ 객체
 * @param uploadedFileNames - 이번 요청에서 함께 업로드된 타일셋 파일명 배열
 * @param slug - 마을 slug
 * @returns 리라이트된 TMJ JSON 문자열
 */
export async function rewriteTmjTilesetPaths(
  tmjJson: TmjJson,
  uploadedFileNames: string[],
  slug: string,
): Promise<string> {
  const uploadedSet = new Set(uploadedFileNames);

  // 공유 타일셋 존재 여부 검증을 위해 GCS 목록 조회
  const sharedFiles = await listSharedTilesets();
  const sharedFileNames = new Set(sharedFiles.map(f => f.fileName));

  const rewritten = { ...tmjJson, tilesets: [...tmjJson.tilesets] };

  for (let i = 0; i < rewritten.tilesets.length; i++) {
    const entry = { ...rewritten.tilesets[i] };
    rewritten.tilesets[i] = entry;

    if (entry.source) {
      // TSX 참조 형태
      const fileName = extractFileName(entry.source);
      if (uploadedSet.has(fileName)) {
        entry.source = `${slug}/tilesets/${fileName}`;
      } else {
        if (!sharedFileNames.has(fileName)) {
          throw new Error(`공유 타일셋 파일을 찾을 수 없습니다: ${fileName}`);
        }
        entry.source = `common/tilesets/${fileName}`;
      }
    } else if (entry.image) {
      // 인라인 타일셋 형태
      const fileName = extractFileName(entry.image);
      if (uploadedSet.has(fileName)) {
        entry.image = `${slug}/tilesets/${fileName}`;
      } else {
        if (!sharedFileNames.has(fileName)) {
          throw new Error(`공유 타일셋 파일을 찾을 수 없습니다: ${fileName}`);
        }
        entry.image = `common/tilesets/${fileName}`;
      }
    }
  }

  return JSON.stringify(rewritten);
}
