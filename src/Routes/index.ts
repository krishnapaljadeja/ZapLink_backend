import express from "express";
//import individual routes here ---
import zapRoute from "./zap.routes";

const router = express.Router();

router.use("/zaps", zapRoute);
export default router;
