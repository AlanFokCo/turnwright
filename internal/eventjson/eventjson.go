// Package eventjson converts agentscope events to protocol-friendly JSON
// maps with the event type injected as "type".
package eventjson

import (
	"encoding/json"

	"github.com/agentscope-ai/agentscope-go/v2/pkg/agentscope/event"
)

// Marshal returns the event as a JSON object with "type" set to its
// agentscope event type (e.g. "text_block_delta").
func Marshal(e event.Event) (map[string]any, error) {
	data, err := json.Marshal(e)
	if err != nil {
		return nil, err
	}
	var m map[string]any
	if err := json.Unmarshal(data, &m); err != nil {
		return nil, err
	}
	m["type"] = string(e.GetEventType())
	return m, nil
}
