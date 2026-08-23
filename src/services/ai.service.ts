interface AIAnalysisResult {
  extracted: {
    product_name: string | null;
    quantity: number | null;
    height_cm: number | null;
    width_cm: number | null;
    decoration_pattern: string | null;
    glaze_type: string | null;
    firing_temperature_c: number | null;
    deadline_days: number | null;
  };
  estimated: {
    clay_kg: number | null;
    glaze_kg: number | null;
    firing_duration_hours: number | null;
  };
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT' | null;
  priority_reason: string | null;
  provenance: any;
}

interface IExtractionResult {
  isValid: boolean;
  data: AIAnalysisResult | null;
  latency: number;
}

export class AIService {
  /**
   * Analyzes the raw order description to extract technical specifications.
   * Currently mocked to bypass actual LLM calls during initial pipeline setup.
   * 
   * @param rawDescription The raw text provided by the customer
   * @returns IExtractionResult containing validation status, latency, and parsed JSON
   */
  async extractCeramicsData(rawDescription: string): Promise<IExtractionResult> {
    const startTime = Date.now();

    try {
      // TODO: Integrate actual AI Agent here (e.g., using LangChain or Google Gemini SDK)
      // Enforce the LLM to return a strictly typed JSON matching the AIAnalysisResult schema.
      
      // Simulating network and LLM processing delay of 1.5 seconds
      await new Promise((resolve) => setTimeout(resolve, 1500));

      // Simulating a successful JSON output based on the OpenAPI spec constraints
      const mockData: AIAnalysisResult = {
        extracted: {
          product_name: "Bình gốm họa tiết sen",
          quantity: 200,
          height_cm: 35,
          width_cm: null,
          decoration_pattern: "Hoa sen",
          glaze_type: "Men lam",
          firing_temperature_c: 1280,
          deadline_days: 10
        },
        estimated: {
          clay_kg: 450,
          glaze_kg: 15,
          firing_duration_hours: 12
        },
        priority: "HIGH",
        priority_reason: "High quantity and tight deadline (10 days)",
        provenance: {} // Character offsets would go here in a real implementation
      };

      const latency = Date.now() - startTime;

      return {
        isValid: true,
        data: mockData,
        latency
      };
    } catch (error) {
      // Graceful degradation: If the AI fails (e.g., timeout, invalid schema), 
      // we still return a response so the workflow isn't completely halted.
      const latency = Date.now() - startTime;
      return {
        isValid: false,
        data: null,
        latency
      };
    }
  }
}