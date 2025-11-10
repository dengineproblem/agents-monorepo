import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { chatbotApi } from '@/services/chatbotApi';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { Upload, FileText, Trash2, Loader2 } from 'lucide-react';

export function DocumentUploader() {
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  
  // Hardcoded user account ID - в реальном приложении получать из auth
  const userAccountId = '0f559eb0-53fa-4b6a-a51b-5d3e15e5864b';

  // Fetch documents
  const { data: documents = [], isLoading } = useQuery({
    queryKey: ['chatbot-documents', userAccountId],
    queryFn: () => chatbotApi.getDocuments(userAccountId),
  });

  // Upload mutation
  const uploadMutation = useMutation({
    mutationFn: (file: File) => chatbotApi.uploadDocument(file, userAccountId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatbot-documents', userAccountId] });
      toast({ title: 'Документ загружен' });
    },
    onError: () => {
      toast({ title: 'Ошибка при загрузке документа', variant: 'destructive' });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (documentId: string) => chatbotApi.deleteDocument(documentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chatbot-documents', userAccountId] });
      toast({ title: 'Документ удалён' });
    },
    onError: () => {
      toast({ title: 'Ошибка при удалении документа', variant: 'destructive' });
    },
  });

  const handleFileSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const file = files[0];
    const allowedTypes = [
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword',
    ];

    if (!allowedTypes.includes(file.type)) {
      toast({
        title: 'Неподдерживаемый формат',
        description: 'Поддерживаются: PDF, Excel, DOCX',
        variant: 'destructive',
      });
      return;
    }

    uploadMutation.mutate(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDelete = (documentId: string, documentName: string) => {
    if (confirm(`Удалить документ "${documentName}"?`)) {
      deleteMutation.mutate(documentId);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Документы</CardTitle>
        <CardDescription>
          Загрузите документы для обучения чатбота (PDF, Excel, DOCX)
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Upload Zone */}
        <div
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
            isDragging
              ? 'border-blue-500 bg-blue-50'
              : 'border-gray-300 hover:border-gray-400'
          }`}
        >
          <Upload className="h-12 w-12 mx-auto mb-4 text-gray-400" />
          <p className="text-sm text-gray-600 mb-2">
            Перетащите файлы сюда или нажмите для выбора
          </p>
          <p className="text-xs text-gray-500">
            PDF, Excel (.xlsx), Word (.docx)
          </p>
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept=".pdf,.xlsx,.xls,.docx,.doc"
            onChange={(e) => handleFileSelect(e.target.files)}
          />
        </div>

        {/* Document List */}
        {isLoading ? (
          <div className="text-center py-4">
            <Loader2 className="h-6 w-6 animate-spin mx-auto text-gray-400" />
          </div>
        ) : documents.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            Документы не загружены
          </div>
        ) : (
          <div className="space-y-2">
            {documents.map((doc: any) => (
              <div
                key={doc.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <FileText className="h-5 w-5 text-blue-600 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{doc.name}</p>
                    <p className="text-xs text-gray-500">
                      {doc.size ? `${(doc.size / 1024).toFixed(1)} KB` : 'Размер неизвестен'}
                    </p>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleDelete(doc.id, doc.name)}
                  disabled={deleteMutation.isPending}
                >
                  <Trash2 className="h-4 w-4 text-red-600" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

