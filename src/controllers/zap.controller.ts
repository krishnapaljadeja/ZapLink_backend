import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { customAlphabet } from "nanoid";
import QRCode from "qrcode";
import prisma from "../utils/prismClient";
import cloudinary from "../middlewares/cloudinary";
import { ApiError } from "../utils/ApiError";
import { ApiResponse } from "../utils/ApiResponse";
import dotenv from "dotenv";
dotenv.config();

const nanoid = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 6);

const FRONTEND_URL =
  process.env.FRONTEND_URL || "https://zaplink.krishnapaljadeja.com";

export const createZap = async (req: Request, res: any) => {
  try {
    const { type, name, originalUrl, password, viewLimit, expiresAt } =
      req.body;
    const file = req.file;

    if (!file && !originalUrl) {
      return res
        .status(400)
        .json(new ApiError(400, "Either a file or a URL must be provided."));
    }
    const shortId = nanoid();
    const zapId = nanoid();
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    let uploadedUrl: string | null = null;

    if (file) {
      uploadedUrl = (file as any).path;
    } else if (originalUrl) {
      uploadedUrl = originalUrl;
    }
    const zap = await prisma.zap.create({
      data: {
        type,
        name,
        cloudUrl: uploadedUrl,
        originalUrl: originalUrl || null,
        qrId: zapId,
        shortId,
        passwordHash: hashedPassword,
        viewLimit: viewLimit ? parseInt(viewLimit) : null,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      },
    });
    const domain = process.env.BASE_URL || "https://api.krishnapaljadeja.com";
    const shortUrl = `${domain}/api/zaps/${shortId}`;

    const qrCode = await QRCode.toDataURL(shortUrl);

    return res.status(201).json(
      new ApiResponse(
        201,
        {
          zapId,
          shortUrl,
          qrCode,
          type,
          name,
        },
        "Zap created successfully."
      )
    );
  } catch (err) {
    console.error("CreateZap Error:", err);
    return res.status(500).json(new ApiError(500, "Internal server error"));
  }
};

export const getZapByShortId = async (req: Request, res: Response) => {
  try {
    const shortId: string = req.params.shortId as string;

    const zap = await prisma.zap.findUnique({
      where: { shortId },
    });

    const now = new Date();
    if (!zap) {
      if (req.headers.accept && req.headers.accept.includes("text/html")) {
        return res.redirect(`${FRONTEND_URL}/zaps/${shortId}?error=notfound`);
      }
      res.status(404).json(new ApiError(404, "Zap not found."));
      return;
    }

    // Ensure consistent timezone handling for expiration check
    if (zap.expiresAt) {
      const expirationTime = new Date(zap.expiresAt);
      const currentTime = new Date();

      // Compare timestamps to avoid timezone issues
      if (currentTime.getTime() > expirationTime.getTime()) {
        return res.redirect(`${FRONTEND_URL}/zaps/${shortId}?error=expired`);
      }
    }

    if (zap.viewLimit !== null && zap.viewCount >= zap.viewLimit) {
      return res.redirect(`${FRONTEND_URL}/zaps/${shortId}?error=viewlimit`);
    }

    if (zap.passwordHash) {
      const providedPassword = req.query.password as string;

      if (!providedPassword) {
        res.status(401).json(new ApiError(401, "Password required."));
        return;
      }

      const isPasswordValid = await bcrypt.compare(
        providedPassword,
        zap.passwordHash
      );

      if (!isPasswordValid) {
        res.status(401).json(new ApiError(401, "Incorrect password."));
        return;
      }
    }

    // Increment view count BEFORE serving
    const updatedZap = await prisma.zap.update({
      where: { shortId },
      data: { viewCount: zap.viewCount + 1 },
    });

    // After increment, check if limit is now exceeded
    if (
      updatedZap.viewLimit !== null &&
      updatedZap.viewCount > updatedZap.viewLimit
    ) {
      if (req.headers.accept && req.headers.accept.includes("text/html")) {
        return res.redirect(`${FRONTEND_URL}/zaps/${shortId}?error=viewlimit`);
      }
      res.status(410).json(new ApiError(410, "Zap view limit reached."));
      return;
    }

    if (zap.originalUrl) {
      const base64Data = zap.originalUrl;
      const matches = base64Data.match(/^data:(image\/[a-zA-Z]+);base64,(.+)$/);
      if (matches) {
        const mimeType = matches[1];
        const base64 = matches[2];
        const buffer = Buffer.from(base64, "base64");

        res.set("Content-Type", mimeType);
        res.send(buffer);
      } else {
        res.status(400).json({ error: "Invalid base64 image data" });
      }
    } else if (zap.cloudUrl) {
      res.redirect(zap.cloudUrl);
    } else {
      res.status(500).json(new ApiError(500, "Zap content not found."));
    }
  } catch (error) {
    res.status(500).json(new ApiError(500, "Internal server error"));
  }
};
