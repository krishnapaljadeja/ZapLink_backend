import express from "express";
import upload from "../middlewares/upload";
import { createZap, getZapByShortId } from "../controllers/zap.controller";


const router = express.Router();

router.post("/upload", upload.single("file"), createZap);
router.get("/:shortId", getZapByShortId);

export default router;
