"""
Test if gemini-2.5-flash supports Computer Use tool
"""
from google import genai
import os
from dotenv import load_dotenv

load_dotenv()

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

print("Testing Computer Use tool with models/gemini-2.5-flash...\n")

# Configure Computer Use tool
config = genai.types.GenerateContentConfig(
    tools=[
        genai.types.Tool(
            computer_use=genai.types.ComputerUse(
                environment=genai.types.Environment.ENVIRONMENT_BROWSER,
            )
        )
    ],
)

# Create a simple test request
contents = [
    genai.types.Content(
        role="user",
        parts=[
            genai.types.Part.from_text(text="Navigate to google.com"),
        ]
    )
]

try:
    response = client.models.generate_content(
        model="gemini-2.5-computer-use-preview-10-2025",
        contents=contents,
        config=config,
    )
    
    print("✅ SUCCESS! Computer Use tool works with models/gemini-2.5-flash\n")
    print("Response:")
    print("-" * 60)
    
    for part in response.candidates[0].content.parts:
        if hasattr(part, "text") and part.text:
            print(f"Text: {part.text}")
        if hasattr(part, "function_call") and part.function_call:
            print(f"Function Call: {part.function_call.name}")
            print(f"Args: {dict(part.function_call.args)}")
    
except Exception as e:
    print(f"❌ ERROR: {e}")
    print("\nThis model may not support Computer Use tool.")
    print("Try using: models/gemini-2.5-computer-use-preview-10-2025")
