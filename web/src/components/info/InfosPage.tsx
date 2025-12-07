// Info 表格视图。
import { useAtom } from 'jotai'
import { useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { createColumnHelper, flexRender, getCoreRowModel, useReactTable, type ColumnPinningState, type ColumnSizingState } from '@tanstack/react-table'
import { infosBySessionAtom, selectedInfoBySessionAtom } from '../../atoms'
import { getInfo, listInfos } from '../../api/client'
import type { InfoListItem, InfoResponse } from '../../types/api'
import TabSwitcher from '../common/TabSwitcher'
import Tag from '../common/Tag'
import { LuSearch } from "react-icons/lu";
import { BsTable } from "react-icons/bs";

interface Props {
  sessionId: string
}

export default function InfoTableTab({ sessionId }: Props) {
  const [infosMap, setInfosMap] = useAtom(infosBySessionAtom)
  const [selectedMap, setSelectedMap] = useAtom(selectedInfoBySessionAtom)
  const [detailMap, setDetailMap] = useState<Record<string, InfoResponse>>({})
  const [loading, setLoading] = useState(false)
  const [loadingDetails, setLoadingDetails] = useState<Record<string, boolean>>({})
  const [activeTab, setActiveTab] = useState<string>('index')
  const [detailTabs, setDetailTabs] = useState<string[]>([])
  const [columnPinning, setColumnPinning] = useState<ColumnPinningState>({ right: ['action'] })
  const [columnSizing, setColumnSizing] = useState<ColumnSizingState>({
    id: 160,
    class: 140,
    name: 200,
    description: 320,
    action: 60,
  })
  const infos: InfoListItem[] = infosMap[sessionId] || []
  const selectedId = selectedMap[sessionId] || null

  useEffect(() => {
    let mounted = true
    const load = async () => {
      setLoading(true)
      try {
        const res = await listInfos(sessionId)
        if (mounted) {
          setInfosMap((prev) => ({ ...prev, [sessionId]: res.infos }))
        }
      } finally {
        setLoading(false)
      }
    }
    load()
    return () => {
      mounted = false
    }
  }, [sessionId, setInfosMap])

  const viewDetail = async (id: string) => {
    setActiveTab(id)
    setDetailTabs((prev) => (prev.includes(id) ? prev : [...prev, id]))
    setSelectedMap((prev) => ({ ...prev, [sessionId]: id }))
    setLoadingDetails((prev) => ({ ...prev, [id]: true }))
    try {
      const info = await getInfo(sessionId, id, true)
      setDetailMap((prev) => ({ ...prev, [id]: info }))
    } finally {
      setLoadingDetails((prev) => ({ ...prev, [id]: false }))
    }
  }

  const closeDetailTab = (key: string) => {
    setDetailTabs((prev) => prev.filter((id) => id !== key))
    if (activeTab === key) {
      setActiveTab('index')
    }
  }

  const tabs = useMemo(() => {
    const base = [{ key: 'index', label: 'Index' }]
    const details = detailTabs.map((id) => ({
      key: id,
      label: `Info ${id.slice(-4)}`,
      closable: true,
    }))
    return [...base, ...details]
  }, [detailTabs])

  const palette = ['#2563eb', '#16a34a', '#f59e0b', '#f97316', '#8b5cf6', '#0ea5e9', '#14b8a6', '#ef4444']
  const classColor = (cls: string) => {
    let hash = 0
    for (let i = 0; i < cls.length; i++) hash = (hash * 31 + cls.charCodeAt(i)) >>> 0
    const idx = hash % palette.length
    return palette[idx]
  }

  const columnHelper = createColumnHelper<InfoListItem>()

  const columns = useMemo(
    () => [
      columnHelper.accessor('id', {
        header: 'ID',
        cell: (info) => <CellText maxWidth={columnSizing.id}>{info.getValue()}</CellText>,
      }),
      columnHelper.accessor('class', {
        header: 'Class',
        cell: (info) => {
          const cls = info.getValue()
          const color = classColor(cls)
          return <Tag bg={`${color}22`} border={`${color}55`} color={color}>{cls}</Tag>
        },
      }),
      columnHelper.accessor('name', {
        header: 'Name',
        cell: (info) => <CellText maxWidth={columnSizing.name}>{info.getValue()}</CellText>,
      }),
      columnHelper.accessor('description', {
        header: '描述',
        cell: (info) => <CellText maxWidth={columnSizing.description}>{info.getValue()}</CellText>,
      }),
      columnHelper.display({
        id: 'action',
        header: '',
        cell: (info) => (
          <button
            className="btn-secondary"
            style={{ padding: '6px 6px', borderRadius: '50%', width: '30px', height: '30px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
            onClick={() => viewDetail(info.row.original.id)}
            aria-label="查看详情"
          >
            <LuSearch size={20} />
          </button>
        ),
        meta: { pinned: true },
      }),
    ],
    [classColor, columnSizing]
  )

  const table = useReactTable({
    data: infos,
    columns,
    getCoreRowModel: getCoreRowModel(),
    state: {
      columnPinning,
      columnSizing,
    },
    onColumnPinningChange: setColumnPinning,
    onColumnSizingChange: setColumnSizing,
    enableColumnPinning: true,
    columnResizeMode: 'onChange',
  })

  const renderDetail = (id: string) => {
    const detail = detailMap[id]
    if (loadingDetails[id]) {
      return <TabPage>加载中...</TabPage>
    }
    if (!detail) {
      return <TabPage>尚未加载详情</TabPage>
    }
    return (
      <TabPage>
        <div className="space-y-2 text-sm">
          <div className="font-semibold">{detail.name}</div>
          <div className="text-slate-500">{detail.description}</div>
          {detail.prompt && (
            <div>
              <div className="text-xs text-slate-500">Prompt</div>
              <pre className="whitespace-pre-wrap text-xs bg-slate-100 p-2 rounded">{detail.prompt}</pre>
            </div>
          )}
          {detail.methods && (
            <div>
              <div className="text-xs text-slate-500">Methods</div>
              <ul className="list-disc pl-4 text-xs">
                {detail.methods.map((m) => (
                  <li key={m}>{m}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <div className="text-xs text-slate-500 mt-2">当前选中: {id}</div>
      </TabPage>
    )
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between mb-2" id='InfosTabHeader'>
        <div className="flex items-center gap-3 px-1">
          <BsTable size={20} color="green" />
          <h4 className="font-semibold">Infos</h4>
        </div>
        <TabSwitcher tabs={tabs} activeKey={activeTab} onChange={setActiveTab} onClose={closeDetailTab} />
      </div>
      {activeTab === 'index' ? (
        <div className="card scroll-area" style={{ maxHeight: '520px' }}>
          {loading && <span className="text-xs text-slate-500">加载中...</span>}
          <table className="w-full text-sm" style={{ borderCollapse: 'collapse' }}>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="text-left text-xs text-slate-500"
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        borderRight: '1px solid var(--border-color)',
                        padding: '6px 8px',
                        whiteSpace: 'nowrap',
                        width: `${header.getSize()}px`,
                        minWidth: `${header.getSize()}px`,
                        maxWidth: `${header.getSize()}px`,
                        position: header.column.getIsPinned() ? 'sticky' : undefined,
                        right: header.column.getIsPinned() === 'right' ? 0 : undefined,
                        left: header.column.getIsPinned() === 'left' ? 0 : undefined,
                        background: 'var(--bg-primary)',
                        zIndex: header.column.getIsPinned() ? 2 : 1,
                      }}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id}>
                  {row.getVisibleCells().map((cell) => (
                    <td
                      key={cell.id}
                      style={{
                        borderBottom: '1px solid var(--border-color)',
                        borderRight: '1px solid var(--border-color)',
                        padding: '3px 8px',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        width: `${cell.column.getSize()}px`,
                        minWidth: `${cell.column.getSize()}px`,
                        maxWidth: `${cell.column.getSize()}px`,
                        position: cell.column.getIsPinned() ? 'sticky' : undefined,
                        right: cell.column.getIsPinned() === 'right' ? 0 : undefined,
                        left: cell.column.getIsPinned() === 'left' ? 0 : undefined,
                        background: cell.column.getIsPinned() ? 'var(--bg-primary)' : undefined,
                        zIndex: cell.column.getIsPinned() ? 1 : undefined,
                      }}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {infos.length === 0 && <div className="text-sm text-slate-500 mt-2">暂无 Info</div>}
        </div>
      ) : (
        renderDetail(activeTab)
      )}
    </div>
  )
}

const CellText = ({ children, maxWidth }: { children: React.ReactNode; maxWidth?: number }) => (
  <span
    style={{
      display: 'inline-block',
      maxWidth: maxWidth ? `${maxWidth}px` : '100%',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    }}
  >
    {children}
  </span>
);

const TabPage = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: var(--radius);
  padding: 12px;
  box-shadow: var(--shadow);
  overflow: auto;
`;

