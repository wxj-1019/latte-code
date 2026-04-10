import * as React from 'react'
import type { CommandResultDisplay } from '../../commands.js'
import { CustomModelSetupFlow } from '../../components/CustomModelSetupFlow.js'
import { useSetAppState } from '../../state/AppState.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import type { SaveCustomModelResult } from '../../utils/customApiStorage.js'

function AddModelCommandView({
  initialName,
  onDone,
}: {
  initialName?: string
  onDone: (
    result?: string,
    options?: { display?: CommandResultDisplay },
  ) => void
}): React.ReactNode {
  const setAppState = useSetAppState()

  const handleSuccess = React.useCallback(
    (result: SaveCustomModelResult) => {
      const savedModel = result.model
      if (!savedModel) {
        return
      }

      setAppState(prev => ({
        ...prev,
        mainLoopModel: savedModel.model,
        mainLoopModelForSession: null,
      }))
    },
    [setAppState],
  )

  return (
    <CustomModelSetupFlow
      initialName={initialName}
      onDone={onDone}
      onSuccess={handleSuccess}
    />
  )
}

export const call: LocalJSXCommandCall = async (
  onDone,
  _context,
  args,
) => {
  const initialName = args?.trim()

  return (
    <AddModelCommandView
      initialName={initialName || undefined}
      onDone={onDone}
    />
  )
}
