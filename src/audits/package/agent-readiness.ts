// Agent-readiness goals: what a website needs so AI agents can find, read, understand and use it.
// Supplied by Openink Hub (12 Nov 2026). The same nine goals are checked in the SEO Audit (parameters 71-79, root domain),
// their fixes go into the SEO report, and the strategy writer uses them to plan the work.

export interface AgentGoal {
  id: number; // SEO Audit parameter id
  goal: string;
  issue: string; // what the audit reports when the goal is not met
  fix: string;
}

export const AGENT_GOALS: AgentGoal[] = [
  { id: 71, goal: 'Content Signals declared', issue: 'No Content-Signal directive in robots.txt.', fix: 'Add a Content-Signal line stating how your content may be used, e.g. "search=yes, ai-train=no".' },
  { id: 72, goal: 'Missing pages return a real 404', issue: 'A non-existent URL did not return a 404 or 410.', fix: 'Return a real 404 status for missing pages. Agents treat HTTP 200 as "this page exists".' },
  { id: 73, goal: 'Organization or LocalBusiness schema is complete', issue: 'Business node is missing fields such as telephone and address.', fix: 'Fill in the missing fields so an agent can answer questions about your business without guessing.' },
  { id: 74, goal: 'Entity is linked to external profiles via sameAs', issue: 'No sameAs links in the structured data.', fix: 'Add sameAs links to your social and directory profiles so agents can confirm you are the same entity.' },
  { id: 75, goal: 'About, contact and legal pages are linked', issue: 'No homepage link found for one or more of: about, contact, legal.', fix: 'Link the missing pages from your homepage.' },
  { id: 76, goal: 'llms.txt is well-formed', issue: 'llms.txt is missing markdown links to your key pages.', fix: 'Follow the llms.txt format: a "# " title, a "> " summary, then sections of markdown links.' },
  { id: 77, goal: 'Serves Markdown when an agent asks for it', issue: 'The homepage returned text/html for Accept: text/markdown.', fix: 'Serve a Markdown representation when agents request it. It cuts token cost dramatically versus HTML.' },
  { id: 78, goal: 'Site exposes WebMCP tools to in-browser agents', issue: 'No WebMCP tools registered on page load.', fix: 'Call navigator.modelContext.registerTool() on page load with a name, description, inputSchema and execute callback, or annotate a form with toolname and tooldescription.' },
  { id: 79, goal: 'MCP Server Card is published', issue: '/.well-known/mcp/server-card.json returned HTML, not JSON (probably a catch-all route).', fix: 'Publish an MCP Server Card (SEP-1649) at /.well-known/mcp/server-card.json with name, version, an endpoint URL and the capabilities your server supports.' },
];

// Compact text for the AI strategy prompt.
export function agentReadinessAsPromptText(): string {
  return AGENT_GOALS.map((g) => `- ${g.goal}: ${g.fix}`).join('\n');
}
