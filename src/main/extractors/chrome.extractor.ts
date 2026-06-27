import { getChromiumProfiles } from "../../shared/browser-profiles";

export function getChromeProfiles(): string[] {
  return getChromiumProfiles("chrome");
}

export function getEdgeProfiles(): string[] {
  return getChromiumProfiles("edge");
}
