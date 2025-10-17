import { supabase } from "@/integrations/supabase/client";

// Эта функция больше не используется. Видео загружается только напрямую через вебхук!
/*
export async function uploadVideoToSupabase(
  user_id: string,
  videoFile: File | Blob
): Promise<{ filePath: string; signedUrl: string }> {
  throw new Error('uploadVideoToSupabase больше не используется. Загрузка видео только через вебхук!');
}
*/

/**
 * Uploads a video file to Supabase Storage and gets a signed URL.
 * 
 * @param user_id - string, current user's id
 * @param videoFile - File or Blob
 * @returns Promise<{ filePath: string; signedUrl: string; }>
 * @throws Error on failure
 */
export async function uploadVideoToSupabase(
  user_id: string,
  videoFile: File | Blob
): Promise<{ filePath: string; signedUrl: string }> {
  if (!user_id) throw new Error("user_id is required");
  if (!videoFile) throw new Error("videoFile is required");

  const timestamp = Date.now();
  const baseName = (videoFile instanceof File && videoFile.name)
    ? videoFile.name.replace(/[^\w.-]+/g, "_")
    : "video.mp4";
  const filePath = `uploads/${user_id}/${timestamp}_${baseName}`;

  // Choose resumable upload for >6MB
  const opts: { cacheControl: string; upsert: boolean; uploadType?: "resumable" } = {
    cacheControl: "3600",
    upsert: false,
  };
  if ((videoFile.size ?? 0) > 6 * 1024 * 1024) {
    opts.uploadType = "resumable";
  }
  // Upload to storage
  const { data, error } = await supabase.storage
    .from("videos")
    .upload(filePath, videoFile, opts);

  if (error || !data) {
    throw new Error(error?.message || "Ошибка загрузки видео в Storage");
  }

  // Get signed URL (valid for 60 seconds)
  const { data: urlData, error: urlErr } = await supabase
    .storage
    .from("videos")
    .createSignedUrl(data.path, 60);

  if (urlErr || !urlData?.signedUrl) {
    throw new Error(urlErr?.message || "Не удалось получить ссылку на видео");
  }

  return { filePath: data.path, signedUrl: urlData.signedUrl };
}
