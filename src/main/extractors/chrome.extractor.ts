import path from "path";
import os from "os";
import { existsSync, readdirSync } from "fs";

export function getChromeProfiles(): string[] {
  const appData =
    process.platform === "win32"
      ? process.env.APPDATA || ""
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support")
        : path.join(os.homedir(), ".config");

  const chromeDataDir =
    process.platform === "win32"
      ? path.join(appData, "Google", "Chrome", "User Data")
      : process.platform === "darwin"
        ? path.join(appData, "Google", "Chrome")
        : path.join(appData, "google-chrome");

  if (!existsSync(chromeDataDir)) {
    return [];
  }

  const items = readdirSync(chromeDataDir);
  const profiles = items
    .filter(
      (item) =>
        item.startsWith("Profile") ||
        item === "Default" ||
        item === "Guest Profile",
    )
    .sort();

  return profiles;
}

export function getEdgeProfiles(): string[] {
  const appData =
    process.platform === "win32"
      ? process.env.APPDATA || ""
      : process.platform === "darwin"
        ? path.join(os.homedir(), "Library", "Application Support")
        : path.join(os.homedir(), ".config");

  const edgeDataDir =
    process.platform === "win32"
      ? path.join(appData, "Microsoft", "Edge", "User Data")
      : process.platform === "darwin"
        ? path.join(appData, "Microsoft Edge")
        : path.join(appData, "microsoft-edge");

  if (!existsSync(edgeDataDir)) {
    return [];
  }

  const items = readdirSync(edgeDataDir);
  const profiles = items
    .filter(
      (item) =>
        item.startsWith("Profile") ||
        item === "Default" ||
        item === "Guest Profile",
    )
    .sort();

  return profiles;
}
