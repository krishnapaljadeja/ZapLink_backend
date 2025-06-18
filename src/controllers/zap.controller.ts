import { Request, Response } from "express";
import bcrypt from "bcrypt";
import { customAlphabet } from "nanoid";
import QRCode from "qrcode";
import prisma from "../utils/prismClient";
import cloudinary from "../middlewares/cloudinary";
import { ApiError } from "../utils/ApiError";
import { ApiResponse } from "../utils/ApiResponse";
import dotenv from "dotenv";
import mammoth from "mammoth";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
dotenv.config();

const nanoid = customAlphabet("1234567890abcdefghijklmnopqrstuvwxyz", 6);

const FRONTEND_URL =
  process.env.FRONTEND_URL || "https://zaplink.krishnapaljadeja.com";

// Helper function to generate HTML for text content
const generateTextHtml = (title: string, content: string) => {
  const escapedContent = content
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  const escapedName = (title || "Untitled")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapedName}</title>
    <style>
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            line-height: 1.6;
            color: #e5e7eb;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
            background-color: #111827;
            min-height: 100vh;
        }
        .container {
            background: #1f2937;
            padding: 30px;
            border-radius: 12px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
            border: 1px solid #374151;
        }
        h1 {
            color: #f9fafb;
            margin-bottom: 20px;
            border-bottom: 2px solid #3b82f6;
            padding-bottom: 10px;
            font-size: 2rem;
            font-weight: 600;
        }
        .content {
            white-space: pre-wrap;
            word-wrap: break-word;
            font-size: 16px;
            color: #d1d5db;
            line-height: 1.7;
        }
        .footer {
            margin-top: 30px;
            padding-top: 20px;
            border-top: 1px solid #374151;
            text-align: center;
            color: #9ca3af;
            font-size: 14px;
        }
        @media (max-width: 768px) {
            body {
                padding: 15px;
            }
            .container {
                padding: 20px;
            }
            h1 {
                font-size: 1.5rem;
            }
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>${escapedName}</h1>
        <div class="content">${escapedContent}</div>
        <div class="footer">
            Powered by ZapLink
        </div>
    </div>
</body>
</html>`;
};

// Helper function to map frontend types to Prisma enum values
const mapTypeToPrismaEnum = (
  type: string
):
  | "PDF"
  | "IMAGE"
  | "VIDEO"
  | "AUDIO"
  | "ZIP"
  | "URL"
  | "TEXT"
  | "WORD"
  | "PPT"
  | "UNIVERSAL" => {
  const typeMap: Record<
    string,
    | "PDF"
    | "IMAGE"
    | "VIDEO"
    | "AUDIO"
    | "ZIP"
    | "URL"
    | "TEXT"
    | "WORD"
    | "PPT"
    | "UNIVERSAL"
  > = {
    pdf: "PDF",
    image: "IMAGE",
    video: "VIDEO",
    audio: "AUDIO",
    archive: "ZIP",
    url: "URL",
    text: "TEXT",
    document: "WORD",
    presentation: "PPT",
    spreadsheet: "UNIVERSAL",
    URL: "URL",
    TEXT: "TEXT",
    DOCUMENT: "WORD",
    PRESENTATION: "PPT",
  };

  return typeMap[type.toLowerCase()] || "UNIVERSAL";
};

export const createZap = async (req: Request, res: any) => {
  try {
    const {
      type,
      name,
      originalUrl,
      textContent,
      password,
      viewLimit,
      expiresAt,
    } = req.body;
    const file = req.file;

    if (!file && !originalUrl && !textContent) {
      return res
        .status(400)
        .json(
          new ApiError(
            400,
            "Either a file, URL, or text content must be provided."
          )
        );
    }
    const shortId = nanoid();
    const zapId = nanoid();
    const hashedPassword = password ? await bcrypt.hash(password, 10) : null;

    let uploadedUrl: string | null = null;
    let contentToStore: string | null = null;

    if (file) {
      uploadedUrl = (file as any).path;

      // Handle DOCX and PPTX files by extracting text content
      if (type === "document" || type === "presentation") {
        try {
          const filePath = (file as any).path;
          const fileName = (file as any).originalname;
          const fileExtension = path.extname(fileName).toLowerCase();

          if (fileExtension === ".docx") {
            // Extract text from DOCX
            const result = await mammoth.extractRawText({ path: filePath });
            const extractedText = result.value;

            if (extractedText.length > 10000) {
              return res
                .status(400)
                .json(
                  new ApiError(
                    400,
                    "Extracted text is too long. Maximum 10,000 characters allowed."
                  )
                );
            }

            contentToStore = `DOCX_CONTENT:${extractedText}`;
          } else if (fileExtension === ".pptx") {
            // For PPTX, we'll store a message indicating it's a presentation
            contentToStore = `PPTX_CONTENT:This is a PowerPoint presentation. The file has been uploaded and can be downloaded from the cloud storage.`;
          }
        } catch (error) {
          console.error("Error extracting text from file:", error);
          // If text extraction fails, fall back to regular file handling
          contentToStore = null;
        }
      }
    } else if (originalUrl) {
      uploadedUrl = originalUrl;
      contentToStore = originalUrl;
    } else if (textContent) {
      // Store text content with a special prefix to distinguish it from URLs
      if (textContent.length > 10000) {
        return res
          .status(400)
          .json(
            new ApiError(
              400,
              "Text content is too long. Maximum 10,000 characters allowed."
            )
          );
      }
      contentToStore = `TEXT_CONTENT:${textContent}`;
    }

    const zap = await prisma.zap.create({
      data: {
        type: mapTypeToPrismaEnum(type),
        name,
        cloudUrl: uploadedUrl,
        originalUrl: contentToStore,
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
        if (req.headers.accept && req.headers.accept.includes("text/html")) {
          return res.redirect(`${FRONTEND_URL}/zaps/${shortId}`);
        }
        res.status(401).json(new ApiError(401, "Password required."));
        return;
      }

      const isPasswordValid = await bcrypt.compare(
        providedPassword,
        zap.passwordHash
      );

      if (!isPasswordValid) {
        if (req.headers.accept && req.headers.accept.includes("text/html")) {
          return res.redirect(
            `${FRONTEND_URL}/zaps/${shortId}?error=incorrect_password`
          );
        }
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
      // Check if originalUrl is a valid URL (starts with http:// or https://)
      if (
        zap.originalUrl.startsWith("http://") ||
        zap.originalUrl.startsWith("https://")
      ) {
        // It's a URL, redirect to it
        if (req.headers.accept && req.headers.accept.includes("text/html")) {
          res.redirect(zap.originalUrl);
        } else {
          res.json({ url: zap.originalUrl, type: "redirect" });
        }
      } else if (zap.originalUrl.startsWith("TEXT_CONTENT:")) {
        // It's text content, serve it as HTML
        const textContent = zap.originalUrl.substring(13); // Remove "TEXT_CONTENT:" prefix

        if (req.headers.accept && req.headers.accept.includes("text/html")) {
          // Generate HTML for text content
          const html = generateTextHtml(zap.name || "Untitled", textContent);
          res.set("Content-Type", "text/html");
          res.send(html);
        } else {
          res.json({ content: textContent, type: "text", name: zap.name });
        }
      } else if (
        zap.originalUrl.startsWith("DOCX_CONTENT:") ||
        zap.originalUrl.startsWith("PPTX_CONTENT:")
      ) {
        // It's text content, serve it as HTML
        const textContent = zap.originalUrl.substring(13); // Remove "DOCX_CONTENT:" or "PPTX_CONTENT:" prefix

        if (req.headers.accept && req.headers.accept.includes("text/html")) {
          // Generate HTML for text content
          const html = generateTextHtml(zap.name || "Untitled", textContent);
          res.set("Content-Type", "text/html");
          res.send(html);
        } else {
          res.json({ content: textContent, type: "document", name: zap.name });
        }
      } else {
        // It might be base64 data, try to parse it
        const base64Data = zap.originalUrl;
        const matches = base64Data.match(
          /^data:(image\/[a-zA-Z]+);base64,(.+)$/
        );
        if (matches) {
          const mimeType = matches[1];
          const base64 = matches[2];
          const buffer = Buffer.from(base64, "base64");

          if (req.headers.accept && req.headers.accept.includes("text/html")) {
            res.set("Content-Type", mimeType);
            res.send(buffer);
          } else {
            res.json({ data: base64Data, type: "image", name: zap.name });
          }
        } else {
          res.status(400).json({ error: "Invalid base64 image data" });
        }
      }
    } else if (zap.cloudUrl) {
      if (req.headers.accept && req.headers.accept.includes("text/html")) {
        res.redirect(zap.cloudUrl);
      } else {
        res.json({ url: zap.cloudUrl, type: "file" });
      }
    } else {
      res.status(500).json(new ApiError(500, "Zap content not found."));
    }
  } catch (error) {
    res.status(500).json(new ApiError(500, "Internal server error"));
  }
};
