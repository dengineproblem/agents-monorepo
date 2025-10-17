
import { supabase } from "@/integrations/supabase/client";

// Define VideoUpload interface directly since the Supabase types haven't been regenerated yet
export interface VideoUpload {
  id: string;
  user_id: string;
  file_path: string;
  signed_url: string;
  original_name: string;
  file_size: number;
  uploaded_at: string;
}

/**
 * Gets the current user's video uploads.
 */
export async function getUserVideoUploads(user_id: string): Promise<VideoUpload[]> {
  // Use type assertion to bypass TypeScript constraint check
  const { data, error } = await supabase
    .from('video_uploads' as any)
    .select('*')
    .eq('user_id', user_id)
    .order('uploaded_at', { ascending: false });

  if (error) throw new Error(error.message);
  // Используем двойное преобразование для обхода проблем с типами
  return (data as unknown) as VideoUpload[];
}
