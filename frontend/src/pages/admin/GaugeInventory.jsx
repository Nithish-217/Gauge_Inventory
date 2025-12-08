import React, { useState } from 'react'
import { Button, Space } from 'antd'
import { UploadOutlined } from '@ant-design/icons'
import EquipmentTable from '../../components/EquipmentTable.jsx'
import EquipmentImportModal from '../../components/EquipmentImportModal.jsx'

export default function GaugeInventory() {
  const [openImport, setOpenImport] = useState(false)
  return (
    <div>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<UploadOutlined />} type="primary" onClick={() => setOpenImport(true)}>
          Upload Equipment (Excel/CSV)
        </Button>
      </Space>
      <EquipmentTable />
      <EquipmentImportModal open={openImport} onClose={() => setOpenImport(false)} />
    </div>
  )
}
