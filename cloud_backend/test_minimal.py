"""
Minimal test to isolate the 404 issue
"""
from google import genai
import os
from dotenv import load_dotenv
import base64

load_dotenv()

client = genai.Client(api_key=os.getenv("GOOGLE_API_KEY"))

print("Testing with minimal screenshot + prompt...\n")

# Create a tiny 1x1 pixel PNG (base64)
tiny_png = b'\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\r\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82'

config = genai.types.GenerateContentConfig(
    tools=[
        genai.types.Tool(
            computer_use=genai.types.ComputerUse(
                environment=genai.types.Environment.ENVIRONMENT_BROWSER,
            )
        )
    ],
)

contents = [
    genai.types.Content(
        parts=[
            genai.types.Part.from_bytes(
                data=tiny_png,
                mime_type="image/png"
            ),
            genai.types.Part.from_text(text="Navigate to google.com"),
        ]
    )
]

try:
    print(f"Using model: gemini-2.5-computer-use-preview-10-2025")
    print(f"API Key: {os.getenv('GOOGLE_API_KEY')[:20]}...")
    print("\nCalling generate_content...\n")
    
    response = client.models.generate_content(
        model="gemini-2.5-computer-use-preview-10-2025",
        contents=contents,
        config=config,
    )
    
    print("✅ SUCCESS!")
    print(f"Response: {response}")
    
except Exception as e:
    print(f"❌ ERROR: {e}")
    print(f"\nFull error details: {type(e).__name__}")
    
    # Try without screenshot
    print("\n" + "="*60)
    print("Trying WITHOUT screenshot (text only)...")
    print("="*60 + "\n")
    
    try:
        contents_text_only = [
            genai.types.Content(
                parts=[
                    genai.types.Part.from_text(text="Navigate to google.com"),
                ]
            )
        ]
        
        response2 = client.models.generate_content(
            model="gemini-2.5-computer-use-preview-10-2025",
            contents=contents_text_only,
            config=config,
        )
        
        print("✅ SUCCESS with text only!")
        print(f"Response: {response2}")
        
    except Exception as e2:
        print(f"❌ ALSO FAILED: {e2}")
