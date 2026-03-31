'use client'

import { useState } from 'react'
import { DragDropContext, Droppable, Draggable, type DropResult } from '@hello-pangea/dnd'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'

export interface Category {
  id: string
  name: string
  color: string
  position: number
}

async function fetchCategories(): Promise<Category[]> {
  const res = await fetch('/api/categories')
  if (!res.ok) throw new Error('Failed to fetch categories')
  return res.json().then((d: { categories: Category[] }) => d.categories)
}

const inputClass =
  'flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm ' +
  'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring ' +
  'placeholder:text-muted-foreground disabled:opacity-50'

export function CategoryList({ initialCategories }: { initialCategories: Category[] }) {
  const queryClient = useQueryClient()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [newName, setNewName] = useState('')
  const [addingNew, setAddingNew] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { data: categories = initialCategories } = useQuery({
    queryKey: ['categories'],
    queryFn: fetchCategories,
    initialData: initialCategories,
  })

  const patchCategory = useMutation({
    mutationFn: async ({ id, body }: { id: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/categories/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (!res.ok) throw new Error('Failed to update')
      return res.json()
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categories'] }),
  })

  const deleteCategory = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/categories/${id}`, { method: 'DELETE' })
      if (res.status === 409) throw new Error('Cannot delete — category still has cards')
      if (!res.ok) throw new Error('Failed to delete')
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['categories'] }),
    onError: (err: Error) => setError(err.message),
  })

  const createCategory = useMutation({
    mutationFn: async (name: string) => {
      const res = await fetch('/api/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, position: categories.length }),
      })
      if (!res.ok) throw new Error('Failed to create')
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['categories'] })
      setNewName('')
      setAddingNew(false)
    },
  })

  const handleDragEnd = async (result: DropResult) => {
    if (!result.destination) return
    const { source, destination } = result
    if (source.index === destination.index) return

    const reordered = [...categories]
    const [moved] = reordered.splice(source.index, 1)
    reordered.splice(destination.index, 0, moved)

    // Optimistic update
    queryClient.setQueryData<Category[]>(['categories'], reordered)

    // Persist new positions
    await Promise.all(
      reordered.map((cat, idx) =>
        patchCategory.mutateAsync({ id: cat.id, body: { position: idx } })
      )
    )
  }

  const startEdit = (cat: Category) => {
    setEditingId(cat.id)
    setEditingName(cat.name)
    setError(null)
  }

  const saveEdit = async (id: string) => {
    if (!editingName.trim()) { setEditingId(null); return }
    await patchCategory.mutateAsync({ id, body: { name: editingName.trim() } })
    setEditingId(null)
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2 flex items-center justify-between">
          <span>{error}</span>
          <button className="underline text-xs ml-2" onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <DragDropContext onDragEnd={handleDragEnd}>
        <Droppable droppableId="categories">
          {(provided) => (
            <div
              ref={provided.innerRef}
              {...provided.droppableProps}
              className="space-y-2"
            >
              {categories.map((cat, index) => (
                <Draggable key={cat.id} draggableId={cat.id} index={index}>
                  {(draggable, snapshot) => (
                    <div
                      ref={draggable.innerRef}
                      {...draggable.draggableProps}
                      className={[
                        'flex items-center gap-3 rounded-lg border bg-background px-3 py-2',
                        snapshot.isDragging ? 'shadow-lg' : '',
                      ].join(' ')}
                    >
                      {/* Drag handle */}
                      <span
                        {...draggable.dragHandleProps}
                        className="text-muted-foreground cursor-grab active:cursor-grabbing select-none text-lg leading-none"
                        title="Drag to reorder"
                      >
                        &#8942;
                      </span>

                      {/* Colour picker */}
                      <label className="relative flex-shrink-0 cursor-pointer" title="Change colour">
                        <span
                          className="block w-4 h-4 rounded-full border border-border"
                          style={{ backgroundColor: cat.color }}
                        />
                        <input
                          type="color"
                          value={cat.color}
                          onChange={(e) =>
                            patchCategory.mutate({ id: cat.id, body: { color: e.target.value } })
                          }
                          className="absolute inset-0 opacity-0 w-full h-full cursor-pointer"
                        />
                      </label>

                      {/* Inline name edit */}
                      {editingId === cat.id ? (
                        <input
                          autoFocus
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          onBlur={() => saveEdit(cat.id)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveEdit(cat.id)
                            if (e.key === 'Escape') setEditingId(null)
                          }}
                          className="flex-1 text-sm bg-transparent border-b border-ring outline-none py-0.5"
                        />
                      ) : (
                        <span
                          className="flex-1 text-sm cursor-pointer hover:underline"
                          onClick={() => startEdit(cat)}
                          title="Click to rename"
                        >
                          {cat.name}
                        </span>
                      )}

                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                        onClick={() => deleteCategory.mutate(cat.id)}
                        title="Delete category"
                      >
                        &times;
                      </Button>
                    </div>
                  )}
                </Draggable>
              ))}
              {provided.placeholder}
            </div>
          )}
        </Droppable>
      </DragDropContext>

      {addingNew ? (
        <div className="flex gap-2">
          <input
            autoFocus
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newName.trim()) createCategory.mutate(newName.trim())
              if (e.key === 'Escape') { setAddingNew(false); setNewName('') }
            }}
            placeholder="Category name…"
            className={inputClass}
          />
          <Button
            size="sm"
            onClick={() => newName.trim() && createCategory.mutate(newName.trim())}
            disabled={createCategory.isPending}
          >
            Add
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => { setAddingNew(false); setNewName('') }}
          >
            Cancel
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="outline" onClick={() => setAddingNew(true)}>
          + Add category
        </Button>
      )}
    </div>
  )
}
