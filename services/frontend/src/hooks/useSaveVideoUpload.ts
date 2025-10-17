
import { supabase } from "@/integrations/supabase/client";

export interface VideoUploadData {
  user_id: string;
  file_path: string;
  signed_url: string;
  original_name: string;
  file_size: number;
}

/**
 * Saves info about a video upload to Supabase table.
 */
export async function saveVideoUpload(data: VideoUploadData) {
  // Use type assertion to bypass TypeScript constraint check
  const { data: result, error } = await supabase
    .from('video_uploads' as any)
    .insert([data])
    .select('id')
    .single();

  if (error) throw new Error(error.message);
  // Используем двойное преобразование типа для обхода ошибки TypeScript
  return { id: (result as any)?.id };
}
