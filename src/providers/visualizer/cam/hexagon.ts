// Hexagon integration stub
import { CamConnection, CamTool } from '../camIntegration';

export class HexagonCamConnection implements CamConnection {
  async connect() { /* TODO: Implement Hexagon API connection */ return false; }
  async getTools(): Promise<CamTool[]> { return []; }
  async getCode(): Promise<string> { return ''; }
}
