// Copyright (c) 2026, WSO2 LLC. (https://www.wso2.com).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

package catalog

// providerModelPrefixes maps gateway LLM provider template handles to the
// provider segment of the "provider/model" identifier the evaluation job's
// LLM client expects (e.g. "bedrock", "openai", "anthropic").
var providerModelPrefixes = map[string]string{
	"openai":          "openai",
	"anthropic":       "anthropic",
	"gemini":          "gemini",
	"groq":            "groq",
	"mistral":         "mistral",
	"mistralai":       "mistral",
	"awsbedrock":      "bedrock",
	"azure-openai":    "azureopenai",
	"azureai-foundry": "azure",
}

// GetProviderPrefix resolves a gateway provider TemplateHandle to the
// "provider/model" prefix string. Returns ("", false) for unknown handles — the
// caller should store the bare model name and let the evaluation job apply its
// default.
func GetProviderPrefix(templateHandle string) (string, bool) {
	prefix, ok := providerModelPrefixes[templateHandle]
	return prefix, ok
}
