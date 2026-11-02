import { api } from "./api";
import { prepareImage } from "./image";

export interface UploadedMedia {
	id: number;
	url: string;
	bytes: number;
	mime: string;
	reused: boolean;
}

interface MediaResponse {
	media: { id: number; url: string; bytes: number; mime: string };
	reused?: boolean;
}

export async function uploadImage(file: File): Promise<UploadedMedia> {
	const prepared = await prepareImage(file);
	const data = await api.post<MediaResponse>("/api/media", {
		mime: prepared.mime,
		data: prepared.data,
	});
	return { ...data.media, reused: data.reused === true };
}
