import { NextRequest, NextResponse } from 'next/server';
import { A2AClient } from '@a2a-js/sdk/client';
import { MessageSendParams, Message } from '@a2a-js/sdk';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log('Agent-chat API received:', JSON.stringify(body, null, 2));
    
    const { agentUrl, message, contextId } = body;
    
    if (!agentUrl || !message) {
      console.log('Missing required fields:', { agentUrl: !!agentUrl, message: !!message });
      return NextResponse.json(
        { error: 'Agent URL and message are required' },
        { status: 400 }
      );
    }

    console.log(`Sending message to agent at: ${agentUrl}`);

    // Create A2A client from card URL
    const client = await A2AClient.fromCardUrl(agentUrl);
    
    // Prepare message payload using A2A SDK format
    const userMessage: Message = {
      kind: 'message',
      messageId: uuidv4(),
      role: 'user',
      parts: [{ kind: 'text', text: message }],
      // FIXME(yoojin): ain adk a2a needs agentId and type. User Id (address) can be used as agentId.
      metadata: { agentId: '123', type: 'CHAT' }
    };

    // Add contextId if provided for continuing conversations (중요: 유지된 contextId 사용)
    if (contextId) {
      userMessage.contextId = contextId;
    }

    const sendParams: MessageSendParams = {
      message: userMessage,
    };

    console.log('Sending message to agent...');
    
    // A2A 클라이언트로 메시지 전송 (SDK가 폴링 및 응답 처리 자동화)
    const response = await client.sendMessage(sendParams);
    
    console.log('Raw A2A response:', JSON.stringify(response, null, 2));
    
    let responseText = 'Agent received your message but did not respond.';
    let finalContextId = contextId;
    let finalTaskId;
    
    // Check different possible response structures
    let responseMessage = null;
    
    // Try different ways to access the response message
    if (response && typeof response === 'object') {
      // JSON-RPC format: response.result IS the message
      if ('result' in response && response.result && typeof response.result === 'object' && 'kind' in response.result) {
        console.log('Found response in result (JSON-RPC format)');
        const { result } = response;
        if ('status' in result && 'message' in result.status) {
          // ain-adk response
          responseMessage = result.status.message;
        } else {
          responseMessage = result;
        }
      } else if ('result' in response && response.result && typeof response.result === 'object' && 'message' in response.result) {
        responseMessage = response.result.message;
        console.log('Found response in result.message');
      } else if ('message' in response) {
        responseMessage = response.message;
        console.log('Found response in message');
      } else if ('data' in response && response.data && typeof response.data === 'object' && 'message' in response.data) {
        responseMessage = response.data.message;
        console.log('Found response in data.message');
      } else {
        console.log('Response structure not recognized, available keys:', Object.keys(response));
      }
    }
    
    // Extract response data if found
    if (responseMessage && typeof responseMessage === 'object') {
      // Extract contextId and taskId
      if ('contextId' in responseMessage) {
        finalContextId = responseMessage.contextId || finalContextId;
      }
      if ('taskId' in responseMessage) {
        finalTaskId = responseMessage.taskId || finalTaskId;
      }
      
      // Extract text from message parts
      if ('parts' in responseMessage && Array.isArray(responseMessage.parts)) {
        const textParts = responseMessage.parts.filter((part: unknown) => {
          return part && 
                 typeof part === 'object' && 
                 'kind' in part && 
                 part.kind === 'text' && 
                 'text' in part && 
                 typeof (part as { text: unknown }).text === 'string';
        });
        if (textParts.length > 0) {
          responseText = textParts.map((part: unknown) => {
            const textPart = part as { text: string };
            return textPart.text || '';
          }).join(' ').trim();
          console.log('Extracted response text:', responseText);
        }
      } else if ('text' in responseMessage && typeof responseMessage.text === 'string') {
        responseText = responseMessage.text;
        console.log('Found direct text response:', responseText);
      }
    }

    return NextResponse.json({ 
      success: true,
      response: responseText,
      contextId: finalContextId,
      taskId: finalTaskId,
      fullResponse: response
    });

  } catch (error) {
    console.error('Error communicating with agent:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to communicate with agent' },
      { status: 500 }
    );
  }
}