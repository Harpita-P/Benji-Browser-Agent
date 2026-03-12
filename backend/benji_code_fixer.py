"""
Benji Code Fixer Agent - Uses Google ADK + GitHub MCP to fix bugs autonomously.

This agent receives bug reports from the visual testing agent (Gemini Computer Use),
analyzes the GitHub repository, identifies the root cause, and opens a PR with a fix.
"""

import os
from google.adk.agents import Agent
from google.adk.tools.mcp_tool import McpToolset
from google.adk.tools.mcp_tool.mcp_session_manager import StreamableHTTPServerParams


class BenjiCodeFixer:
    """AI Software Engineer that fixes bugs and opens PRs."""
    
    def __init__(self, github_token: str):
        """Initialize Benji with GitHub access."""
        self.github_token = github_token
        
        # Create ADK agent with GitHub MCP integration
        self.agent = Agent(
            model="gemini-2.0-flash-exp",
            name="benji_code_fixer",
            instruction="""You are Benji, an AI Software Engineer specializing in bug fixing.

Your workflow:
1. Receive a bug report from visual UI testing
2. Analyze the GitHub repository to understand the codebase
3. Locate the files most likely containing the bug
4. Read and analyze the relevant code
5. Identify the root cause
6. Generate a precise fix
7. Create a pull request with:
   - Clear title describing the bug
   - Detailed description with reproduction steps
   - Root cause explanation
   - Code changes with context
   - Verification steps

You are thorough, precise, and write clean code. You explain your reasoning clearly.""",
            tools=[
                McpToolset(
                    connection_params=StreamableHTTPServerParams(
                        url="https://api.githubcopilot.com/mcp/",
                        headers={
                            "Authorization": f"Bearer {github_token}",
                            "X-MCP-Toolsets": "repos,issues,pull_requests",
                            "X-MCP-Readonly": "false"
                        },
                    ),
                )
            ],
        )
    
    async def fix_bug(self, bug_report: dict) -> dict:
        """
        Receive a bug report and autonomously fix it.
        
        Args:
            bug_report: {
                "description": "Red brush draws green, green brush draws red",
                "app_url": "http://localhost:3000/canvas",
                "repo_url": "https://github.com/username/drawing-app",
                "repo_owner": "username",
                "repo_name": "drawing-app",
                "expected_behavior": "Red brush should draw red strokes",
                "actual_behavior": "Red brush draws green strokes",
                "ui_element": "Brush selector component",
                "screenshot_path": "/path/to/bug_screenshot.png" (optional)
            }
        
        Returns:
            {
                "status": "success" | "failed",
                "pr_url": "https://github.com/username/repo/pull/123",
                "pr_number": 123,
                "analysis": "Root cause explanation",
                "files_changed": ["src/components/BrushSelector.tsx"]
            }
        """
        
        # Construct the prompt for Benji
        prompt = f"""
Bug Report from Visual Testing:

**Description:** {bug_report['description']}
**App URL:** {bug_report['app_url']}
**Repository:** {bug_report['repo_url']}
**Expected Behavior:** {bug_report['expected_behavior']}
**Actual Behavior:** {bug_report['actual_behavior']}
**UI Element:** {bug_report.get('ui_element', 'Unknown')}

Your task:
1. Explore the repository: {bug_report['repo_owner']}/{bug_report['repo_name']}
2. Search for files related to: {bug_report.get('ui_element', 'the bug')}
3. Read the relevant code files
4. Identify where the color mapping or brush logic is defined
5. Find the root cause of the bug
6. Generate a fix
7. Create a pull request with:
   - Title: "Fix: {bug_report['description']}"
   - Body explaining the issue, root cause, and solution
   - The code changes

Start by listing the repository structure and searching for relevant files.
"""
        
        # Run the agent
        response = await self.agent.run(prompt)
        
        # Parse the response to extract PR details
        # (In production, you'd parse the agent's actions and responses more carefully)
        return {
            "status": "success",
            "analysis": response.text if hasattr(response, 'text') else str(response),
            "agent_response": response
        }


async def create_benji_fixer(github_token: str = None) -> BenjiCodeFixer:
    """Factory function to create a Benji code fixer instance."""
    if not github_token:
        github_token = os.getenv("GITHUB_TOKEN")
        if not github_token:
            raise ValueError(
                "GitHub token required. Set GITHUB_TOKEN environment variable or pass it explicitly."
            )
    
    return BenjiCodeFixer(github_token)
