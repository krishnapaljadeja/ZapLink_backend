import { Response } from "express";
import { ApiResponse } from "../utils/ApiResponse";
import { ApiError } from "../utils/ApiError";
import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient();