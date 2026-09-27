import path from "path";
import { existsSync, readdirSync } from "fs";
import os from "os";
import type { ExtractionData } from "../../types";
import { extractChromeProfileData } from "./chrome.extractor";

function getEdgeDataDir(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA || "";
    return path.join(localAppData, "Microsoft", "Edge", "User Data");
  } else if (process.platform === "darwin") {
    const appSupport = path.join(os.homedir(), "Library", "Application Support");
    return path.join(appSupport, "Microsoft Edge");
  } else {
    return path.join(os.homedir(), ".config", "microsoft-edge");
  }
}

export function getEdgeProfiles(): string[] {
  try {
    const edgeDataDir = getEdgeDataDir();
    console.log("[Edge] Looking for profiles in:", edgeDataDir);

    if (!existsSync(edgeDataDir)) {
      console.warn("[Edge] Edge data directory not found at:", edgeDataDir);
      return [];
    }

    const items = readdirSync(edgeDataDir);
    const profiles = items
      .filter(
        (item) =>
          item.startsWith("Profile") ||
          item === "Default" ||
          item === "Guest Profile"
      )
      .sort();

    console.log("[Edge] Found profiles:", profiles);
    return profiles;
  } catch (error) {
    console.warn("[Edge] Error getting profiles:", error);
    return [];
  }
}

export async function extractEdgeProfileData(
  profileName: string,
  vintedBaseUrl: string = "https://www.vinted.com"
): Promise<ExtractionData> {
  try {
    console.log("[Edge] Extracting from profile:", profileName);
    const extractedData = await extractChromeProfileData(
      profileName,
      "edge",
      vintedBaseUrl
    );
    return extractedData;
  } catch (error) {
    console.error("[Edge] Extraction error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);

    if (errorMessage.includes("file is locked")) {
      const troubleshootingSteps = `
Failed to extract Edge profile data: The database file is locked.

Troubleshooting steps:
1. Close Microsoft Edge completely (all windows and tabs)
2. Check Task Manager for hidden Edge processes:
   - Press Ctrl+Shift+Esc to open Task Manager
   - Look for "msedge.exe" and end all processes
3. If still locked, try these additional steps:
   - Disable Windows Search temporarily (search "Disable Indexing Service" in Settings)
   - Check if antivirus is scanning the file (exclude from scan)
   - Restart your computer
4. Try the extraction again`;
      throw new Error(troubleshootingSteps);
    }

    throw new Error(`Failed to extract Edge profile data: ${errorMessage}`);
  }
}
