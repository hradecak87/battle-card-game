import {
  blockPlayer,
  isValidMessageBody,
  listConversations,
  listDmMessages,
  listGlobalMessages,
  markRead,
  sendMessage,
  unblockPlayer,
} from './api'

const rpc = jest.fn()

jest.mock('@/lib/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
  },
}))

describe('chat api wrappers', () => {
  beforeEach(() => {
    rpc.mockReset()
  })

  it('validates trimmed chat bodies client-side', () => {
    expect(isValidMessageBody(' Ahoj ')).toBe(true)
    expect(isValidMessageBody('   ')).toBe(false)
    expect(isValidMessageBody('x'.repeat(500))).toBe(true)
    expect(isValidMessageBody('x'.repeat(501))).toBe(false)
  })

  it('calls chat_send_message with the expected DM payload', async () => {
    const response = { data: { id: 1 }, error: null }
    rpc.mockResolvedValue(response)

    await expect(
      sendMessage({
        channelType: 'dm',
        recipientId: 'player-2',
        body: 'Ahoj',
      }),
    ).resolves.toEqual(response)

    expect(rpc).toHaveBeenCalledWith('chat_send_message', {
      p_channel_type: 'dm',
      p_recipient_id: 'player-2',
      p_body: 'Ahoj',
    })
  })

  it('passes null recipient ids for global messages', async () => {
    rpc.mockResolvedValue({ data: { id: 2 }, error: null })

    await sendMessage({
      channelType: 'global',
      body: 'Do světa',
    })

    expect(rpc).toHaveBeenCalledWith('chat_send_message', {
      p_channel_type: 'global',
      p_recipient_id: null,
      p_body: 'Do světa',
    })
  })

  it('calls chat_list_global_messages with nullable pagination arguments', async () => {
    const response = { data: [], error: null }
    rpc.mockResolvedValue(response)

    await expect(listGlobalMessages()).resolves.toEqual(response)
    expect(rpc).toHaveBeenCalledWith('chat_list_global_messages', {
      p_before_id: null,
      p_limit: 30,
    })
  })

  it('calls chat_list_dm_messages with the expected payload', async () => {
    rpc.mockResolvedValue({ data: [], error: null })

    await listDmMessages('conv-1', 77, 20)

    expect(rpc).toHaveBeenCalledWith('chat_list_dm_messages', {
      p_conversation_id: 'conv-1',
      p_before_id: 77,
      p_limit: 20,
    })
  })

  it('calls chat_list_conversations without arguments', async () => {
    rpc.mockResolvedValue({ data: [], error: null })

    await listConversations()

    expect(rpc).toHaveBeenCalledWith('chat_list_conversations')
  })

  it('calls chat_mark_read with the conversation id', async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await markRead('conv-2')

    expect(rpc).toHaveBeenCalledWith('chat_mark_read', {
      p_conversation_id: 'conv-2',
    })
  })

  it('calls chat_block_player and chat_unblock_player with the target id', async () => {
    rpc.mockResolvedValue({ data: null, error: null })

    await blockPlayer('player-9')
    await unblockPlayer('player-9')

    expect(rpc).toHaveBeenNthCalledWith(1, 'chat_block_player', {
      p_target_id: 'player-9',
    })
    expect(rpc).toHaveBeenNthCalledWith(2, 'chat_unblock_player', {
      p_target_id: 'player-9',
    })
  })
})
