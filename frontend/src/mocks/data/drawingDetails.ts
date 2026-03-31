export type MockDrawingSensor = {
  id: string
  left: number
  top: number
  variant: 'green' | 'yellow'
}

export type MockDrawingDetail = {
  id: string
  name: string
  imagePath: string
  sensors: MockDrawingSensor[]
}

export const mockDrawingDetails: Record<string, MockDrawingDetail> = {
  'drawing-1': {
    id: 'drawing-1',
    name: '도면 1',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_1-556f4a43-5990-4b5d-8c52-1f4230429a94.png',
    sensors: [
      { id: 'S1-1', left: 180, top: 240, variant: 'green' },
      { id: 'S1-2', left: 280, top: 300, variant: 'yellow' },
      { id: 'S1-3', left: 360, top: 360, variant: 'green' },
      { id: 'S1-4', left: 520, top: 260, variant: 'green' },
      { id: 'S1-5', left: 600, top: 420, variant: 'yellow' },
    ],
  },
  'drawing-2': {
    id: 'drawing-2',
    name: '도면 2',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_2-3ac0c7a9-8a3a-43ea-b45c-4e43a99bbeef.png',
    sensors: [
      { id: 'S2-1', left: 210, top: 260, variant: 'green' },
      { id: 'S2-2', left: 310, top: 320, variant: 'yellow' },
      { id: 'S2-3', left: 410, top: 380, variant: 'green' },
      { id: 'S2-4', left: 560, top: 280, variant: 'green' },
      { id: 'S2-5', left: 620, top: 440, variant: 'yellow' },
    ],
  },
  'drawing-3': {
    id: 'drawing-3',
    name: '도면 3',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_3-913c70e6-e189-4728-8a13-3869e57d270e.png',
    sensors: [
      { id: 'S3-1', left: 170, top: 250, variant: 'green' },
      { id: 'S3-2', left: 290, top: 310, variant: 'yellow' },
      { id: 'S3-3', left: 380, top: 370, variant: 'green' },
      { id: 'S3-4', left: 530, top: 270, variant: 'green' },
      { id: 'S3-5', left: 610, top: 430, variant: 'yellow' },
    ],
  },
  'drawing-4': {
    id: 'drawing-4',
    name: '도면 4',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_4-5ac81381-b8fc-4a88-94b8-08f55a0b52e9.png',
    sensors: [
      { id: 'S4-1', left: 200, top: 240, variant: 'green' },
      { id: 'S4-2', left: 320, top: 300, variant: 'yellow' },
      { id: 'S4-3', left: 430, top: 360, variant: 'green' },
      { id: 'S4-4', left: 570, top: 260, variant: 'green' },
      { id: 'S4-5', left: 640, top: 420, variant: 'yellow' },
    ],
  },
  'drawing-5': {
    id: 'drawing-5',
    name: '도면 5',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_5-6c8150d2-7e36-4289-bf5a-245d1bdd15eb.png',
    sensors: [
      { id: 'S5-1', left: 190, top: 260, variant: 'green' },
      { id: 'S5-2', left: 310, top: 330, variant: 'yellow' },
      { id: 'S5-3', left: 420, top: 390, variant: 'green' },
      { id: 'S5-4', left: 560, top: 290, variant: 'green' },
      { id: 'S5-5', left: 630, top: 450, variant: 'yellow' },
    ],
  },
  'drawing-6': {
    id: 'drawing-6',
    name: '도면 6',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_6-ffb5fcd7-ce86-440b-b55d-614cbae67aeb.png',
    sensors: [
      { id: 'S6-1', left: 180, top: 250, variant: 'green' },
      { id: 'S6-2', left: 300, top: 320, variant: 'yellow' },
      { id: 'S6-3', left: 410, top: 380, variant: 'green' },
      { id: 'S6-4', left: 550, top: 280, variant: 'green' },
      { id: 'S6-5', left: 620, top: 440, variant: 'yellow' },
    ],
  },
  'drawing-7': {
    id: 'drawing-7',
    name: '도면 7',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_7-37af5d58-8834-4c2d-9175-977e1e22182a.png',
    sensors: [
      { id: 'S7-1', left: 200, top: 240, variant: 'green' },
      { id: 'S7-2', left: 330, top: 310, variant: 'yellow' },
      { id: 'S7-3', left: 440, top: 370, variant: 'green' },
      { id: 'S7-4', left: 580, top: 270, variant: 'green' },
      { id: 'S7-5', left: 650, top: 430, variant: 'yellow' },
    ],
  },
  'drawing-8': {
    id: 'drawing-8',
    name: '도면 8',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_8-28385b9e-c612-423b-bbbb-660b3c1d4908.png',
    sensors: [
      { id: 'S8-1', left: 170, top: 260, variant: 'green' },
      { id: 'S8-2', left: 290, top: 330, variant: 'yellow' },
      { id: 'S8-3', left: 400, top: 390, variant: 'green' },
      { id: 'S8-4', left: 540, top: 290, variant: 'green' },
      { id: 'S8-5', left: 610, top: 450, variant: 'yellow' },
    ],
  },
  'drawing-9': {
    id: 'drawing-9',
    name: '도면 9',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_9-f064847b-7692-48ae-a831-8db869b3b573.png',
    sensors: [
      { id: 'S9-1', left: 190, top: 250, variant: 'green' },
      { id: 'S9-2', left: 310, top: 320, variant: 'yellow' },
      { id: 'S9-3', left: 420, top: 380, variant: 'green' },
      { id: 'S9-4', left: 560, top: 280, variant: 'green' },
      { id: 'S9-5', left: 630, top: 440, variant: 'yellow' },
    ],
  },
  'drawing-10': {
    id: 'drawing-10',
    name: '도면 10',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_10-50aa964a-a0e3-4dbe-8638-26b6eb7b3387.png',
    sensors: [
      { id: 'S10-1', left: 210, top: 240, variant: 'green' },
      { id: 'S10-2', left: 330, top: 300, variant: 'yellow' },
      { id: 'S10-3', left: 450, top: 360, variant: 'green' },
      { id: 'S10-4', left: 590, top: 260, variant: 'green' },
      { id: 'S10-5', left: 660, top: 420, variant: 'yellow' },
    ],
  },
  'drawing-11': {
    id: 'drawing-11',
    name: '도면 11',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_11-fc2446b0-7f22-4d78-bc67-f4fff9b25f5e.png',
    sensors: [
      { id: 'S11-1', left: 190, top: 240, variant: 'green' },
      { id: 'S11-2', left: 310, top: 300, variant: 'yellow' },
      { id: 'S11-3', left: 420, top: 360, variant: 'green' },
      { id: 'S11-4', left: 560, top: 260, variant: 'green' },
      { id: 'S11-5', left: 640, top: 420, variant: 'yellow' },
    ],
  },
  'drawing-12': {
    id: 'drawing-12',
    name: '도면 12',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_12-08f18926-00bf-4cfe-b1a9-cbf5bc774791.png',
    sensors: [
      { id: 'S12-1', left: 210, top: 260, variant: 'green' },
      { id: 'S12-2', left: 330, top: 320, variant: 'yellow' },
      { id: 'S12-3', left: 440, top: 380, variant: 'green' },
      { id: 'S12-4', left: 580, top: 280, variant: 'green' },
      { id: 'S12-5', left: 650, top: 440, variant: 'yellow' },
    ],
  },
  'drawing-13': {
    id: 'drawing-13',
    name: '도면 13',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_13-c82f982d-e169-488b-aeb8-cc1730eaf3df.png',
    sensors: [
      { id: 'S13-1', left: 180, top: 250, variant: 'green' },
      { id: 'S13-2', left: 300, top: 320, variant: 'yellow' },
      { id: 'S13-3', left: 410, top: 380, variant: 'green' },
      { id: 'S13-4', left: 550, top: 280, variant: 'green' },
      { id: 'S13-5', left: 620, top: 440, variant: 'yellow' },
    ],
  },
  'drawing-14': {
    id: 'drawing-14',
    name: '도면 14',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_14-580dfe1e-6d1a-44f1-a81e-78dcdf02f9a9.png',
    sensors: [
      { id: 'S14-1', left: 200, top: 240, variant: 'green' },
      { id: 'S14-2', left: 330, top: 310, variant: 'yellow' },
      { id: 'S14-3', left: 440, top: 370, variant: 'green' },
      { id: 'S14-4', left: 580, top: 270, variant: 'green' },
      { id: 'S14-5', left: 650, top: 430, variant: 'yellow' },
    ],
  },
  'drawing-15': {
    id: 'drawing-15',
    name: '도면 15',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_15-ba6b004e-0b75-4cf5-a9bf-8d5cafb6478b.png',
    sensors: [
      { id: 'S15-1', left: 190, top: 260, variant: 'green' },
      { id: 'S15-2', left: 310, top: 330, variant: 'yellow' },
      { id: 'S15-3', left: 420, top: 390, variant: 'green' },
      { id: 'S15-4', left: 560, top: 290, variant: 'green' },
      { id: 'S15-5', left: 630, top: 450, variant: 'yellow' },
    ],
  },
  'drawing-16': {
    id: 'drawing-16',
    name: '도면 16',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_16-6cb4a549-6f42-4bd4-8edb-9b178f524b3d.png',
    sensors: [
      { id: 'S16-1', left: 170, top: 260, variant: 'green' },
      { id: 'S16-2', left: 290, top: 330, variant: 'yellow' },
      { id: 'S16-3', left: 400, top: 390, variant: 'green' },
      { id: 'S16-4', left: 540, top: 290, variant: 'green' },
      { id: 'S16-5', left: 610, top: 450, variant: 'yellow' },
    ],
  },
  'drawing-18': {
    id: 'drawing-18',
    name: '도면 18',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_18-3ebe5522-5ccc-4055-aabd-88964d111afd.png',
    sensors: [
      { id: 'S18-1', left: 200, top: 250, variant: 'green' },
      { id: 'S18-2', left: 320, top: 320, variant: 'yellow' },
      { id: 'S18-3', left: 430, top: 380, variant: 'green' },
      { id: 'S18-4', left: 570, top: 280, variant: 'green' },
      { id: 'S18-5', left: 640, top: 440, variant: 'yellow' },
    ],
  },
  'drawing-19': {
    id: 'drawing-19',
    name: '도면 19',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_19-f7e1a6cd-4fae-4837-a1d8-9e9e605efdc9.png',
    sensors: [
      { id: 'S19-1', left: 180, top: 240, variant: 'green' },
      { id: 'S19-2', left: 300, top: 300, variant: 'yellow' },
      { id: 'S19-3', left: 410, top: 360, variant: 'green' },
      { id: 'S19-4', left: 550, top: 260, variant: 'green' },
      { id: 'S19-5', left: 620, top: 420, variant: 'yellow' },
    ],
  },
  'drawing-20': {
    id: 'drawing-20',
    name: '도면 20',
    imagePath:
      '/mock-drawings/c__Users_hanna_AppData_Roaming_Cursor_User_workspaceStorage_be28888f42f1e76c3a9e8104c67c18d0_images_map_20-5450ed8a-8177-4925-9829-649b4de66b3f.png',
    sensors: [
      { id: 'S20-1', left: 210, top: 240, variant: 'green' },
      { id: 'S20-2', left: 330, top: 300, variant: 'yellow' },
      { id: 'S20-3', left: 450, top: 360, variant: 'green' },
      { id: 'S20-4', left: 590, top: 260, variant: 'green' },
      { id: 'S20-5', left: 660, top: 420, variant: 'yellow' },
    ],
  },
}

