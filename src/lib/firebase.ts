import { initializeApp, getApps, cert, App } from 'firebase-admin/app';
import { getStorage, Storage } from 'firebase-admin/storage';

let app: App | undefined;
let storage: Storage | undefined;

/**
 * Firebase Admin 앱 초기화
 */
function initializeFirebaseAdmin(): App {
    if (app) {
        return app;
    }

    // 이미 초기화된 앱이 있으면 재사용
    const existingApps = getApps();
    if (existingApps.length > 0) {
        app = existingApps[0];
        return app;
    }

    // 환경 변수에서 Firebase 설정 가져오기
    const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const storageBucket = process.env.FIREBASE_STORAGE_BUCKET;

    if (!serviceAccount || !projectId || !storageBucket) {
        throw new Error(
            'Firebase environment variables are not set. ' +
            'Please set FIREBASE_SERVICE_ACCOUNT_KEY, FIREBASE_PROJECT_ID, and FIREBASE_STORAGE_BUCKET.'
        );
    }

    let serviceAccountKey;
    try {
        // JSON 문자열로 저장된 경우 파싱
        serviceAccountKey = typeof serviceAccount === 'string' 
            ? JSON.parse(serviceAccount) 
            : serviceAccount;
    } catch {
        throw new Error('FIREBASE_SERVICE_ACCOUNT_KEY is not a valid JSON format.');
    }

    // 디버깅: 사용 중인 service account email 확인
    const serviceAccountEmail = serviceAccountKey.client_email;
    console.log('[Firebase] Initializing with service account:', serviceAccountEmail);
    console.log('[Firebase] Project ID:', projectId);
    console.log('[Firebase] Storage Bucket:', storageBucket);

    app = initializeApp({
        credential: cert(serviceAccountKey),
        projectId: projectId,
        storageBucket: storageBucket,
    });

    return app;
}

/**
 * Firebase Storage 인스턴스 가져오기
 */
export function getFirebaseStorage(): Storage {
    if (storage) {
        return storage;
    }

    const appInstance = initializeFirebaseAdmin();
    storage = getStorage(appInstance);
    return storage;
}

/**
 * GCP Storage Bucket에 이미지 업로드
 * @param fileBuffer - 업로드할 파일의 Buffer
 * @param fileName - 저장할 파일명 (경로 포함 가능, 예: 'images/agent/avatar.png')
 * @param contentType - 파일의 MIME 타입 (예: 'image/png', 'image/jpeg')
 * @param usePublicUrl - 공개 URL 사용 여부 (기본값: true). false인 경우 서명된 URL 생성
 * @returns 업로드된 파일의 공개 URL 또는 서명된 URL
 */
export async function uploadImageToBucket(
    fileBuffer: Buffer,
    fileName: string,
    contentType: string = 'image/png',
    usePublicUrl: boolean = true
): Promise<string> {
    try {
        const storageInstance = getFirebaseStorage();
        const bucket = storageInstance.bucket();
        const file = bucket.file(fileName);

        console.log('[Firebase] Uploading file to:', fileName);
        console.log('[Firebase] Bucket name:', bucket.name);

        // 파일 업로드
        // Uniform Bucket-Level Access가 활성화된 경우 public 옵션을 사용할 수 없음
        // 버킷 레벨 IAM 정책으로 공개 접근을 제어해야 함
        await file.save(fileBuffer, {
            metadata: {
                contentType: contentType,
                cacheControl: 'public, max-age=31536000', // 1년 캐시
            },
            // public: true 옵션 제거 - Uniform Bucket-Level Access와 충돌
        });

        // URL 반환
        if (usePublicUrl) {
            // 공개 URL 반환 (버킷이 IAM 정책으로 공개 접근을 허용하도록 설정되어 있어야 함)
            const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
            console.log('[Firebase] Upload successful, public URL:', publicUrl);
            return publicUrl;
        } else {
            // 서명된 URL 생성 (15년 유효 - 거의 영구적)
            const [signedUrl] = await file.getSignedUrl({
                action: 'read',
                expires: '01-01-2040', // 먼 미래 날짜
            });
            console.log('[Firebase] Upload successful, signed URL:', signedUrl);
            return signedUrl;
        }
    } catch (error) {
        console.error('[Firebase] Failed to upload image:', error);
        if (error instanceof Error) {
            console.error('[Firebase] Error details:', {
                message: error.message,
                stack: error.stack,
            });
        }
        throw new Error(
            `Failed to upload image: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

/**
 * Storage에서 파일 삭제
 * @param fileName - 삭제할 파일명 (경로 포함)
 */
export async function deleteFileFromBucket(fileName: string): Promise<void> {
    try {
        const storageInstance = getFirebaseStorage();
        const bucket = storageInstance.bucket();
        const file = bucket.file(fileName);

        await file.delete();
    } catch (error) {
        console.error('Failed to delete file:', error);
        throw new Error(
            `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
    }
}

