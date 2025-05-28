import multer from "multer";
import { CloudinaryStorage } from "multer-storage-cloudinary";
import cloudinary from "./cloudinary";

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: (req, file) => ({
    folder: "zaplink_uploads",
    allowed_formats: ["jpg", "jpeg", "png", "pdf", "doc", "docx", "mp4", "zip"],
  }),
});

const upload = multer({ storage });

export default upload;
